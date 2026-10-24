import {
  causeArray,
  causeBoolean,
  causeString,
  isBoolean,
  isNumber,
  isObjectLike,
  isString,
} from "../internal/decode.js";
import { mailboxAddress } from "../internal/address.js";
import type { EmailAddress, EmailMessage, MaybePromise, OneOrMany } from "../types.js";
import { durationToMs } from "./duration.js";
import { WorkflowError, WorkflowNonRetryableError } from "./errors.js";
import { workflowIdempotencyKey } from "./idempotency.js";
import { isTerminalRun } from "./memory.js";
import type {
  AnyWorkflowDefinition,
  WorkflowContext,
  WorkflowDuration,
  WorkflowEngine,
  WorkflowEngineOptions,
  WorkflowEventInput,
  WorkflowEventResult,
  WorkflowHooks,
  WorkflowInboxEvent,
  WorkflowJsonValue,
  WorkflowLease,
  WorkflowRetryPolicy,
  WorkflowRun,
  WorkflowSendRecord,
  WorkflowStepRecord,
  WorkflowWait,
} from "./types.js";

const defaultRetry = { maxAttempts: 3, backoffMs: 60_000 };

const defaultLease: WorkflowDuration = "5m";

const inboxLimit = 50;

const defaultResumeDueLimit = 25;

const defaultResumeDueConcurrency = 10;

// Journal keys are step names. Schema parsers drop an own `__proto__` key from a record, so a step
// with this name would lose its completed entry on the next read and run again.
const reservedStepName = "__proto__";

// Every conflict means another writer saved, so a write among N concurrent writers succeeds within
// N attempts. Past this bound the store is either overloaded or broken, and the caller gets an error.
const commitAttempts = 25;

// EmailErrorCode values. Errors are recognized by shape, because a CommonJS build bundles each
// package entry separately and the root entry's error classes then differ from this entry's.
const emailErrorCodes = new Set([
  "validation_error",
  "adapter_not_found",
  "adapter_error",
  "route_error",
  "all_recipients_failed",
  "middleware_error",
  "aborted",
]);

const workflowErrorNames = new Set(["WorkflowError", "WorkflowNonRetryableError"]);

// Mistakes in how a definition calls `ctx`, which fail the run instead of reaching the caller.
const definitionErrorCodes = new Set(["invalid_definition", "invalid_duration", "invalid_value"]);

type ResolvedRetry = { maxAttempts: number; backoffMs: number };

type ExecutionOutcome =
  | { kind: "completed"; output: WorkflowJsonValue | void }
  | { kind: "failed"; error: Error }
  | { kind: "suspended" };

type RunTransform = (run: WorkflowRun) => WorkflowRun;

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function resolveRetry(...policies: (WorkflowRetryPolicy | undefined)[]): ResolvedRetry {
  let maxAttempts = defaultRetry.maxAttempts;
  let backoffMs = defaultRetry.backoffMs;

  for (const policy of policies) {
    if (policy?.maxAttempts !== undefined) maxAttempts = policy.maxAttempts;

    if (policy?.backoff !== undefined) backoffMs = durationToMs(policy.backoff);
  }

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new WorkflowError("invalid_definition", "Retry maxAttempts must be a positive integer.");
  }

  return { maxAttempts, backoffMs };
}

/**
 * Whether an Email SDK error allows a retry, or undefined for other errors. A route or
 * all-recipients error wraps the adapter failures, and is retryable when any of them is.
 */
function sdkRetryable(cause: unknown): boolean | undefined {
  const code = causeString(cause, "code");
  const retryable = causeBoolean(cause, "retryable");

  if (code === undefined || !emailErrorCodes.has(code) || retryable === undefined) return undefined;

  if (code !== "route_error" && code !== "all_recipients_failed") return retryable;

  return retryable || causeArray(cause, "failures").some((failure) => causeBoolean(failure, "retryable") === true);
}

function isPermanentFailure(cause: unknown): boolean {
  if (cause instanceof WorkflowNonRetryableError || cause instanceof WorkflowError) return true;

  const name = causeString(cause, "name");

  if (name !== undefined && workflowErrorNames.has(name)) return true;

  return sdkRetryable(cause) === false;
}

/** A WorkflowError caused by the definition's own `ctx` call, such as a negative duration. */
function isDefinitionError(cause: unknown): cause is WorkflowError {
  return cause instanceof WorkflowError && definitionErrorCodes.has(cause.code);
}

type WorkflowJsonObject = { readonly [key: string]: WorkflowJsonValue | undefined };

function isJsonArray(value: WorkflowJsonValue): value is readonly WorkflowJsonValue[] {
  return Array.isArray(value);
}

/** Plain objects only: a Date, Map, class instance, or function has another prototype. */
function isPlainObject(value: WorkflowJsonObject): boolean {
  const prototype: object | null = Object.getPrototypeOf(value);

  return prototype === Object.prototype || prototype === null;
}

/**
 * True when `value` survives a JSON round trip unchanged, apart from `undefined` object fields being
 * dropped. The static type already says JSON; this catches what it can't, such as NaN and Infinity
 * (saved as null), empty array slots (saved as null), a cycle (which JSON can't encode), or a Date
 * from untyped code. `ancestors` holds the containers above `value`; a shared, acyclic reference
 * is fine, since it saves as two equal copies.
 */
function isJsonValue(value: WorkflowJsonValue, ancestors: readonly object[] = []): boolean {
  if (value === null || isString(value) || isBoolean(value)) return true;

  if (isNumber(value)) return Number.isFinite(value);

  if (!isObjectLike(value) || ancestors.includes(value)) return false;

  const path = [...ancestors, value];

  // Spreading reads empty slots as undefined, which `every` would otherwise skip.
  if (isJsonArray(value)) return [...value].every((item) => item !== undefined && isJsonValue(item, path));

  if (!isPlainObject(value)) return false;

  return Object.values(value).every((field) => field === undefined || isJsonValue(field, path));
}

/** Throws `invalid_value` unless `value` is undefined (a `void` result) or JSON. */
function assertJson(value: WorkflowJsonValue | void, what: string) {
  if (value !== undefined && !isJsonValue(value)) {
    throw new WorkflowError("invalid_value", `${what} must be JSON: finite numbers, strings, booleans, null, arrays, and plain objects.`);
  }
}

/** A copy of a run for a hook, so a hook that edits what it was given can't change the next save. */
function detached(run: WorkflowRun): WorkflowRun {
  return structuredClone(run);
}

/**
 * The value as a store gives it back: a fresh JSON round trip, with no shared references and no
 * `undefined` object fields. Workflow code gets this form on the first execution as well as on
 * replay, so a wake can't change what it sees, and editing it can't change the journal.
 */
function savedForm<T extends WorkflowJsonValue | void>(value: T): T {
  // SAFETY: callers pass values that passed `isJsonValue` or came from the store, so the round trip
  // yields the same JSON value; only `undefined` fields, which T allows to be absent, are dropped.
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function addressOf(address: EmailAddress): string {
  return mailboxAddress(address).trim().toLowerCase();
}

function addressList(addresses: OneOrMany<EmailAddress> | undefined): EmailAddress[] {
  if (addresses === undefined) return [];

  return isAddressList(addresses) ? [...addresses] : [addresses];
}

function isAddressList(addresses: OneOrMany<EmailAddress>): addresses is readonly EmailAddress[] {
  return Array.isArray(addresses);
}

function recipientsOf(message: EmailMessage): string[] {
  return [...addressList(message.to), ...addressList(message.cc), ...addressList(message.bcc)].map(
    addressOf,
  );
}

type WorkflowHookEvents = {
  [K in keyof WorkflowHooks]-?: Parameters<NonNullable<WorkflowHooks[K]>>[0];
};

/** WorkflowHooks keyed so a generic hook name selects a handler that accepts its own event. */
type WorkflowHookHandlers = {
  [K in keyof WorkflowHooks]?: (event: WorkflowHookEvents[K]) => MaybePromise<void>;
};

/** The first inbox event that satisfies an event wait: same name, received by the deadline. */
function matchingEventIndex(inbox: readonly WorkflowInboxEvent[], event: string, until: number | undefined) {
  return inbox.findIndex((delivered) => delivered.name === event && (until === undefined || delivered.receivedAt <= until));
}

function withoutIndex(inbox: readonly WorkflowInboxEvent[], index: number): WorkflowInboxEvent[] {
  return [...inbox.slice(0, index), ...inbox.slice(index + 1)];
}

function definitionKey(name: string, version: number) {
  return `${name}@${version}`;
}

/** The stored step result, or the workflow output, with `undefined` (a `void` return) left out. */
function jsonResult(value: WorkflowJsonValue | void): WorkflowJsonValue | undefined {
  return value === undefined ? undefined : value;
}

function hasLiveLease(run: WorkflowRun, at: number) {
  return run.lease !== undefined && run.lease.until > at;
}

/** True when the run's wait has a delivered event that satisfies it. */
function hasMatchedEvent(run: WorkflowRun) {
  return run.wait?.kind === "event" && matchingEventIndex(run.inbox, run.wait.event, run.wait.until) !== -1;
}

function isSameWait(a: WorkflowWait | undefined, b: WorkflowWait | undefined) {
  if (a === undefined || b === undefined) return a === b;

  const sameEvent = a.kind !== "event" || (b.kind === "event" && a.event === b.event);

  return a.kind === b.kind && a.step === b.step && a.until === b.until && sameEvent;
}

/**
 * True when `fresh` is unclaimed and still stands where `parked` left it: the same wait and the same
 * steps. Writes that don't claim a run, such as an event delivery, leave both alone; an execution
 * that claimed the run and moved it on changes one of them.
 */
function isParkedAt(fresh: WorkflowRun, parked: WorkflowRun) {
  if (fresh.status !== "waiting" || fresh.lease !== undefined) return false;

  if (!isSameWait(fresh.wait, parked.wait)) return false;

  const steps = Object.keys(parked.journal);

  return (
    Object.keys(fresh.journal).length === steps.length &&
    steps.every((step) => fresh.journal[step]?.status === parked.journal[step]?.status)
  );
}

/** True when a worker may claim the run now: active, unleased, and not blocked on a future wait. */
function isRunnable(run: WorkflowRun, at: number) {
  if (isTerminalRun(run) || hasLiveLease(run, at)) return false;

  if (!run.wait) return true;

  return (run.wait.until !== undefined && run.wait.until <= at) || hasMatchedEvent(run);
}

function dueAtFor(run: WorkflowRun, at: number): number | undefined {
  if (isTerminalRun(run)) return undefined;

  if (run.lease) return run.lease.until;

  if (!run.wait || hasMatchedEvent(run)) return at;

  return run.wait.until;
}

/**
 * Creates a workflow engine over a store and scheduler. The engine keeps no per-run state, so
 * several engines (processes) may share one store. An execution first claims the run with a
 * revision-checked lease, renews it before every step, and stops as soon as a save shows that it
 * lost the lease or that the run was canceled.
 */
export function createWorkflowEngine(options: WorkflowEngineOptions): WorkflowEngine {
  const definitions = new Map<string, AnyWorkflowDefinition>();
  const latestVersion = new Map<string, number>();
  const { store, scheduler, email } = options;
  const hooks: WorkflowHooks = options.hooks ?? {};
  const now = () => (options.clock ? options.clock.now() : Date.now());
  const generateId = options.generateId ?? (() => crypto.randomUUID());
  const leaseMs = durationToMs(options.leaseDuration ?? defaultLease);

  if (leaseMs <= 0) throw new WorkflowError("invalid_definition", "leaseDuration must be positive.");

  for (const definition of options.workflows) {
    const key = definitionKey(definition.name, definition.version);

    if (definitions.has(key)) {
      throw new WorkflowError("invalid_definition", `Workflow ${key} is registered twice.`);
    }

    definitions.set(key, definition);
    latestVersion.set(definition.name, Math.max(latestVersion.get(definition.name) ?? 0, definition.version));
  }

  resolveRetry(options.retry);

  function definitionFor(run: Pick<WorkflowRun, "workflow" | "version">): AnyWorkflowDefinition {
    const definition = definitions.get(definitionKey(run.workflow, run.version));

    if (!definition) {
      throw new WorkflowError(
        "workflow_not_registered",
        `Workflow ${definitionKey(run.workflow, run.version)} is not registered with this engine. Keep old versions registered until their runs finish.`,
      );
    }

    return definition;
  }

  async function invokeHook<K extends keyof WorkflowHooks>(name: K, event: WorkflowHookEvents[K]) {
    const handlers: WorkflowHookHandlers = hooks;

    try {
      // A copy of the run, so a hook that edits what it was given can't change what is saved next.
      await handlers[name]?.({ ...event, run: detached(event.run) });
    } catch {
      // Hooks are observability callbacks and never change run behavior.
    }
  }

  /**
   * Applies `transform` and saves with a revision check. On a conflict it reloads and re-applies
   * the transform to the fresh state, so concurrent event deliveries are not lost; transforms must
   * therefore decide from the run they are given. With an `owner`, every save renews that
   * execution's lease while the run is running and releases it once the run waits or ends, and the
   * commit gives up when the fresh run is held by someone else, unless `adopts` accepts the fresh
   * run. Returns undefined when nothing was saved: the transform declined, the run disappeared,
   * became terminal, or changed owner. Throws `write_conflict` when every attempt lost to a
   * concurrent write.
   */
  async function commit(
    base: WorkflowRun,
    transform: (run: WorkflowRun) => WorkflowRun | undefined,
    owner?: string,
    adopts?: (fresh: WorkflowRun) => boolean,
  ): Promise<WorkflowRun | undefined> {
    let current = base;

    for (let attempt = 0; attempt < commitAttempts; attempt += 1) {
      const at = now();
      const next = transform(current);

      if (!next) return undefined;

      if (owner !== undefined) {
        // A claimed run keeps its persisted wait (sleep target, event deadline, retry) until the
        // step resolves it, so status, not the wait, says whether the execution still holds it.
        next.lease = isTerminalRun(next) || next.status === "waiting" ? undefined : { owner, until: at + leaseMs };
      } else if (isTerminalRun(next)) {
        next.lease = undefined;
      }

      next.revision = current.revision + 1;
      next.updatedAt = at;
      next.dueAt = dueAtFor(next, at);

      if (await store.save(next, current.revision)) return next;

      const fresh = await store.get(base.id);

      if (!fresh || isTerminalRun(fresh)) return undefined;

      if (owner !== undefined && fresh.lease?.owner !== owner && adopts?.(fresh) !== true) return undefined;
      current = fresh;
    }

    throw new WorkflowError(
      "write_conflict",
      `Run ${base.id} could not be saved: write conflict after ${commitAttempts} attempts. Retry the call.`,
    );
  }

  /** Takes the run for one execution. Returns undefined when it is not runnable or another worker won. */
  async function claim(base: WorkflowRun): Promise<{ run: WorkflowRun; owner: string } | undefined> {
    const owner = crypto.randomUUID();

    const claimed = await commit(base, (run) =>
      isRunnable(run, now())
        ? { ...run, status: "running", lease: { owner, until: now() + leaseMs } }
        : undefined,
    );

    return claimed ? { run: claimed, owner } : undefined;
  }

  /**
   * Schedules the wake for a wait the caller just saved. The save has already released the run,
   * so a newer execution may schedule its own wake first; the revision lets the scheduler keep
   * the newer one, and an early wake that still lands re-arms from `dueAt` in `resumeRun`.
   */
  async function scheduleWake(run: WorkflowRun) {
    if (run.wait?.until !== undefined) {
      await scheduler?.schedule({ runId: run.id, at: run.wait.until, revision: run.revision });
    }
  }

  /** Saves the cancellation. Returns undefined when the run had already ended or changed owner. */
  async function saveCancellation(run: WorkflowRun, reason: string, owner?: string): Promise<WorkflowRun | undefined> {
    return await commit(run, (current) => ({ ...current, status: "canceled", cancelReason: reason, wait: undefined }), owner);
  }

  /** What follows a saved cancellation: dropping the run's timer and telling `onRunCanceled`. */
  async function afterCancellation(canceled: WorkflowRun, reason: string) {
    await scheduler?.cancel(canceled.id);
    await invokeHook("onRunCanceled", { run: canceled, reason });
  }

  async function cancelRun(run: WorkflowRun, reason: string, owner?: string): Promise<WorkflowRun | undefined> {
    const canceled = await saveCancellation(run, reason, owner);

    if (canceled) await afterCancellation(canceled, reason);

    return canceled;
  }

  /** `pending` when it settles before the next timer turn, otherwise `fallback`. */
  async function settledWithinTurn<T>(pending: Promise<T>, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;

    const turn = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(fallback), 0);
    });

    try {
      return await Promise.race([pending, turn]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** Replays the run's definition until it completes, fails, suspends on a wait, or loses the run. */
  async function execute(loaded: WorkflowRun, owner: string): Promise<WorkflowRun | undefined> {
    const definition = definitionFor(loaded);
    let current: WorkflowRun = loaded;
    let stopped = false;
    let lost = false;
    let infrastructureError: Error | undefined;
    let signalSuspended: () => void = () => {};

    const suspended = new Promise<ExecutionOutcome>((resolve) => {
      signalSuspended = () => resolve({ kind: "suspended" });
    });

    // What suspended `ctx` calls await. It belongs to this execution, so once the execution is
    // over nothing references the abandoned workflow call and the garbage collector can free it.
    const neverSettles = new Promise<never>(() => {});
    const seen = new Set<string>();
    let queue: Promise<void> = Promise.resolve();
    // Names the step whose callback is running synchronously right now. `ctx` calls queue behind
    // that step, so a call from inside its callback would wait for the callback that awaits it.
    // While the callback's synchronous part runs, no other code can, so a `ctx` call in that
    // window comes from the callback and fails. Once the callback first awaits, `run` may make
    // sibling calls, which queue as usual; telling those apart from a call the callback makes
    // after an `await` needs async context tracking, which isn't portable across runtimes. The
    // flag belongs to this execution, so a callback may still start or resume other runs.
    let callingStep: string | undefined;

    function callStep<T>(name: string, fn: () => T): T {
      const previous = callingStep;

      callingStep = name;

      try {
        return fn();
      } finally {
        callingStep = previous;
      }
    }

    function suspend(): Promise<never> {
      stopped = true;
      signalSuspended();

      return neverSettles;
    }

    async function save(
      transform: (run: WorkflowRun) => WorkflowRun,
      adopts?: (fresh: WorkflowRun) => boolean,
    ): Promise<boolean> {
      if (lost) return false;

      const next = await commit(current, transform, owner, adopts);

      if (!next) {
        lost = true;

        return false;
      }

      current = next;

      return true;
    }

    /** Proves this execution still owns an active run, and extends the lease, before an effect. */
    function renew() {
      return save((run) => ({ ...run }));
    }

    /**
     * Runs `body` while renewing the lease every third of its duration. The timer stops as soon as
     * a renewal shows the run was canceled, finished, or taken over, even if `body` never settles.
     * A renewal that throws (a store outage) keeps the timer, since the lease may still be held.
     */
    async function withHeartbeat<T>(body: () => Promise<T>): Promise<T> {
      let beat: Promise<unknown> = Promise.resolve();

      const timer = setInterval(() => {
        beat = beat
          .then(renew)
          .catch(() => true)
          .then((owned) => {
            if (!owned) clearInterval(timer);
          });
      }, Math.max(1, Math.floor(leaseMs / 3)));

      try {
        return await body();
      } finally {
        clearInterval(timer);
        await beat;
      }
    }

    function operation<T>(name: string, body: () => Promise<T>): Promise<T> {
      if (stopped) return neverSettles;

      const enclosing = callingStep;

      if (enclosing !== undefined) {
        return Promise.reject(
          new WorkflowError(
            "invalid_definition",
            `"${name}" was called inside step "${enclosing}". A step callback can't call ctx; return from the step and make the call after it.`,
          ),
        );
      }

      if (name === reservedStepName) {
        return Promise.reject(
          new WorkflowError(
            "invalid_definition",
            `"${reservedStepName}" can't name a step: stores that parse the journal as a record, such as the Convex store, drop that key, so the step would run again on every wake.`,
          ),
        );
      }

      if (seen.has(name)) {
        return Promise.reject(
          new WorkflowError(
            "duplicate_step",
            `Step "${name}" ran twice in workflow ${definitionKey(current.workflow, current.version)}. Step names must be unique per run; include a loop index in the name.`,
          ),
        );
      }

      seen.add(name);

      // Step failures are handled inside `body`. A definition error, such as a negative duration,
      // fails the run: replaying it would only throw again. Anything else that escapes is a store,
      // scheduler, or suppression-check failure: the run's state is unknown, so the execution stops
      // and the error reaches the engine's caller instead of the definition.
      const result = queue.then(() =>
        stopped
          ? neverSettles
          : body().catch(async (cause: unknown) => {
              let escaped = cause;

              if (isDefinitionError(cause)) {
                try {
                  await failRun(cause, name);

                  return suspend();
                } catch (failure) {
                  escaped = failure;
                }
              }

              infrastructureError = toError(escaped);

              return suspend();
            }),
      );

      queue = result.then(
        () => undefined,
        () => undefined,
      );

      return result;
    }

    function completedRecord(name: string) {
      const record = current.journal[name];

      return record?.status === "completed" ? record : undefined;
    }

    function withStep(name: string, record: WorkflowStepRecord): RunTransform {
      return (run) => ({
        ...run,
        status: "running",
        wait: undefined,
        journal: { ...run.journal, [name]: record },
      });
    }

    async function failRun(error: Error, step?: string, adopts?: (fresh: WorkflowRun) => boolean) {
      const failed = await save(
        (run) => ({
          ...run,
          status: "failed",
          wait: undefined,
          error: step === undefined ? { message: error.message } : { message: error.message, step },
        }),
        adopts,
      );

      if (failed) await invokeHook("onRunFailed", { run: current, error });
    }

    async function sideEffect(
      name: string,
      kind: "send" | "step",
      retry: WorkflowRetryPolicy | undefined,
      effect: () => Promise<WorkflowJsonValue | void>,
    ): Promise<WorkflowJsonValue | undefined> {
      if (!(await renew())) return suspend();

      const previous = current.journal[name];
      const attempt = (previous?.status === "retrying" ? previous.attempts : 0) + 1;
      const policy = resolveRetry(options.retry, definition.retry, retry);
      const startedAt = now();

      if (hooks.onStepStart) {
        await invokeHook("onStepStart", { run: current, step: name, kind, attempt });

        // The hook may have taken any amount of time, and the run may have been canceled
        // meanwhile. Ownership must be proven after the last await before the effect starts.
        if (!(await renew())) return suspend();
      }

      let result: WorkflowJsonValue | void;

      try {
        result = await withHeartbeat(effect);
      } catch (cause) {
        const error = toError(cause);
        const willRetry = !isPermanentFailure(cause) && attempt < policy.maxAttempts;

        if (lost) return suspend();

        await invokeHook("onStepError", { run: current, step: name, kind, attempt, error, willRetry });

        if (!willRetry) {
          await failRun(error, name);

          return suspend();
        }

        const until = now() + policy.backoffMs * 2 ** (attempt - 1);

        const saved = await save((run) => ({
          ...run,
          status: "waiting",
          wait: { kind: "retry", step: name, until },
          journal: { ...run.journal, [name]: { status: "retrying", kind, attempts: attempt, lastError: error.message } },
        }));

        if (saved) await scheduleWake(current);

        return suspend();
      }

      const stored = savedForm(jsonResult(result));

      if (!(await save(withStep(name, { status: "completed", kind, result: stored, completedAt: now() })))) {
        return suspend();
      }

      await invokeHook("onStepComplete", {
        run: current,
        step: name,
        kind,
        attempt,
        durationMs: now() - startedAt,
      });

      return stored;
    }

    /**
     * Completes the sleep once its persisted `until` has passed; otherwise records the wait,
     * releasing the lease, and suspends.
     */
    async function sleepUntil(name: string, until: number) {
      const wait = current.wait;
      const target = wait?.kind === "sleep" && wait.step === name ? wait.until : until;

      if (target <= now()) {
        if (!(await save(withStep(name, { status: "completed", kind: "sleep", completedAt: now() })))) {
          return suspend();
        }

        return;
      }

      if (await save((run) => ({ ...run, status: "waiting", wait: { kind: "sleep", step: name, until: target } }))) {
        await scheduleWake(current);
      }

      return suspend();
    }

    const ctx: WorkflowContext = {
      runId: loaded.id,
      workflow: loaded.workflow,
      version: loaded.version,
      subject: loaded.subject,
      startedAt: loaded.createdAt,
      send(name, message, sendOptions) {
        return operation(name, async () => {
          const record = completedRecord(name);

          if (record) {
            // SAFETY: this journal entry was written from the WorkflowSendRecord this same step
            // returned on an earlier execution; send steps only ever journal that record.
            return savedForm(record.result as WorkflowSendRecord);
          }

          if (options.isSuppressed) {
            for (const address of recipientsOf(message)) {
              if (await options.isSuppressed(address)) {
                const canceled = await cancelRun(current, "suppressed", owner);

                if (canceled) current = canceled;
                else lost = true;

                return suspend();
              }
            }
          }

          const idempotencyKey = await workflowIdempotencyKey(loaded.id, name);

          const sent = await sideEffect(name, "send", undefined, async () => {
            const response = await email.send(message, { ...sendOptions, idempotencyKey });
            const sendRecord: WorkflowSendRecord = { adapter: response.adapter };

            if (response.id !== undefined) sendRecord.id = response.id;

            return sendRecord;
          });

          // SAFETY: sideEffect returns exactly the WorkflowSendRecord the effect above produced.
          return savedForm(sent as WorkflowSendRecord);
        });
      },
      step(name, fn, stepOptions) {
        return operation(name, async () => {
          const record = completedRecord(name);

          const result = record
            ? record.result
            : await sideEffect(name, "step", stepOptions?.retry, async () => {
                const value = await callStep(name, fn);

                assertJson(value, `The result of step "${name}"`);

                return value;
              });

          // SAFETY: the journaled value is what `fn` returned for this step name, persisted as JSON;
          // TResult is constrained to JSON values, so the round trip preserves its type.
          return savedForm(result as Awaited<ReturnType<typeof fn>>);
        });
      },
      sleep(name, duration: WorkflowDuration) {
        return operation(name, async () => {
          if (completedRecord(name)) return;

          await sleepUntil(name, now() + durationToMs(duration));
        });
      },
      sleepUntil(name, at) {
        return operation(name, async () => {
          if (completedRecord(name)) return;

          const until = Number(at);

          if (!Number.isFinite(until)) {
            throw new WorkflowError("invalid_duration", `sleepUntil "${name}" needs a valid Date or epoch milliseconds.`);
          }

          await sleepUntil(name, until);
        });
      },
      waitForEvent(name, waitOptions) {
        return operation(name, async () => {
          const record = completedRecord(name);

          if (record) {
            // SAFETY: event steps journal a WorkflowEventResult. Event payloads are not parsed: the
            // caller's type argument states the payload contract, as it does for sendEvent.
            return savedForm(record.result as WorkflowEventResult<never>);
          }

          const event = waitOptions?.event ?? name;
          const persisted = current.wait?.kind === "event" && current.wait.step === name ? current.wait : undefined;

          // The deadline is fixed the first time the run reaches this step and persisted with the
          // wait, so every worker resolves event versus timeout against the same timestamps.
          const until = persisted
            ? persisted.until
            : waitOptions?.timeout === undefined
              ? undefined
              : now() + durationToMs(waitOptions.timeout);

          const wait: WorkflowWait = until === undefined ? { kind: "event", step: name, event } : { kind: "event", step: name, event, until };
          let outcome: WorkflowEventResult<WorkflowJsonValue | undefined> | undefined;

          // One revision-checked save decides between consuming an event, timing out, and waiting.
          // A delivery that lands first makes the save conflict, and the retry sees its event.
          const saved = await save((run) => {
            const index = matchingEventIndex(run.inbox, event, until);
            const delivered = run.inbox[index];

            if (delivered) {
              outcome = { status: "received", payload: delivered.payload, receivedAt: delivered.receivedAt };

              return {
                ...withStep(name, { status: "completed", kind: "event", result: outcome, completedAt: now() })(run),
                inbox: withoutIndex(run.inbox, index),
              };
            }

            if (until !== undefined && until <= now()) {
              outcome = { status: "timed_out" };

              return withStep(name, { status: "completed", kind: "event", result: outcome, completedAt: now() })(run);
            }

            outcome = undefined;

            return { ...run, status: "waiting", wait };
          });

          if (!saved) return suspend();

          if (outcome) {
            // SAFETY: see the replay branch above; the payload type is the caller's declared contract.
            return savedForm(outcome as WorkflowEventResult<never>);
          }

          await scheduleWake(current);

          return suspend();
        });
      },
    };

    // Starting inside `then` turns a synchronous throw from `run` into a failed outcome.
    const finished = Promise.resolve()
      .then(async () => await definition.run(ctx, savedForm(loaded.input)))
      .then(
      (output): ExecutionOutcome => ({ kind: "completed", output }),
      (cause: unknown): ExecutionOutcome => ({ kind: "failed", error: toError(cause) }),
    );

    let outcome = await Promise.race([finished, suspended]);

    // Every queued microtask runs before a timer does, so one timer turn lets a rejection already
    // on its way, such as a rejected sibling in `Promise.all` beside `ctx.waitForEvent`, settle
    // `run` before the execution counts as suspended. A rejection behind real I/O or a timer
    // arrives later and is replayed on the run's next wake.
    if (outcome.kind === "suspended") outcome = await settledWithinTurn(finished, outcome);

    // A `ctx` call the definition forgot to await may still be running; let it finish or suspend.
    if (outcome.kind !== "suspended") await Promise.race([queue, suspended]);

    if (infrastructureError) throw infrastructureError;

    // A sibling `ctx` call may have saved a wait after `run` rejected, as with a rejected promise in
    // `Promise.all` beside `ctx.waitForEvent`. The rejection still fails the run. A stop that ended
    // the run itself (a cancel, a failed step, a lost lease) stands.
    const failedBesideWait = outcome.kind === "failed" && !lost && !isTerminalRun(current);

    if (outcome.kind === "suspended" || (stopped && !failedBesideWait)) {
      return lost ? await store.get(loaded.id) : current;
    }

    stopped = true;

    const output = outcome.kind === "completed" ? jsonResult(outcome.output) : undefined;

    if (outcome.kind === "failed") {
      // A wait a sibling saved has released the run, so another engine's write, such as an event
      // delivery, may land before the failure. The failure still wins while the run stands where
      // this execution parked it; a run another execution claimed is left to that execution.
      const parked = current;

      await failRun(outcome.error, undefined, (fresh) => isParkedAt(fresh, parked));
    } else if (!isJsonValue(output ?? null)) {
      await failRun(new WorkflowError("invalid_value", "The workflow output must be JSON."));
    } else if (await save((run) => ({ ...run, status: "completed", wait: undefined, output: savedForm(output) }))) {
      await invokeHook("onRunComplete", { run: current });
    }

    if (!lost) await scheduler?.cancel(loaded.id);

    return lost ? await store.get(loaded.id) : current;
  }

  /** Claims and executes the run when it is runnable. `executed` is false when it was left alone. */
  async function resumeRun(runId: string): Promise<{ run: WorkflowRun | undefined; executed: boolean }> {
    const run = await store.get(runId);

    if (!run || !isRunnable(run, now())) {
      // An early or stale wake may have taken the place of the run's real timer. Arm one for the
      // persisted due time so the run never waits without a wake.
      if (run && run.dueAt !== undefined && run.dueAt > now()) {
        await scheduler?.schedule({ runId: run.id, at: run.dueAt, revision: run.revision });
      }

      return { run, executed: false };
    }

    // Resolve the definition before writing, so a missing version leaves the run untouched.
    definitionFor(run);

    const claimed = await claim(run);

    if (!claimed) return { run: await store.get(runId), executed: false };

    return { run: await execute(claimed.run, claimed.owner), executed: true };
  }

  /** What delivering one event did to one run. A canceled run still needs `afterCancellation`. */
  type Delivery =
    | { kind: "missed" }
    | { kind: "saved"; resume: boolean }
    | { kind: "canceled"; run: WorkflowRun; reason: string };

  /**
   * Saves one event to one run: a cancelOn event saves the cancellation, any other event joins the
   * inbox. Nothing else runs, so one run's hooks or timer can't hold up delivery to the next.
   */
  async function deliver(runId: string, event: WorkflowInboxEvent): Promise<Delivery> {
    const run = await store.get(runId);

    if (!run || isTerminalRun(run)) return { kind: "missed" };

    const definition = definitionFor(run);

    if (definition.cancelOn.includes(event.name)) {
      const reason = `event:${event.name}`;
      const canceled = await saveCancellation(run, reason);

      return canceled ? { kind: "canceled", run: canceled, reason } : { kind: "missed" };
    }

    // Delivery only appends to the inbox. The run's wait, including its deadline, stays as it is:
    // the execution that consumes the event compares `receivedAt` with that deadline.
    const updated = await commit(run, (current) => ({ ...current, inbox: [...current.inbox, event].slice(-inboxLimit) }));

    if (!updated) return { kind: "missed" };

    return { kind: "saved", resume: updated.wait?.kind === "event" && updated.wait.event === event.name };
  }

  /**
   * Saves the event, with one receipt time, to every target before any of them runs. Only then does
   * it finish cancellations (timers and hooks) and resume the runs the event satisfies, all
   * concurrently, so one run's slow step or hook can't delay or expire another's wait or cancel.
   */
  async function sendEvent(input: WorkflowEventInput): Promise<string[]> {
    assertJson(input.payload, `The payload of event "${input.name}"`);

    // Receipt is the call, so a slow subject lookup can't push an on-time event past its deadline.
    const receivedAt = now();

    const targets =
      input.runId === undefined ? (await store.listActiveBySubject(input.subject)).map((run) => run.id) : [input.runId];

    const event: WorkflowInboxEvent =
      input.payload === undefined
        ? { name: input.name, receivedAt }
        : { name: input.name, payload: savedForm(input.payload), receivedAt };

    const reached: string[] = [];
    const followUps: (() => Promise<void>)[] = [];
    const errors: Error[] = [];

    for (const runId of targets) {
      try {
        const delivered = await deliver(runId, event);

        if (delivered.kind === "missed") continue;

        reached.push(runId);

        if (delivered.kind === "canceled") {
          followUps.push(async () => await afterCancellation(delivered.run, delivered.reason));
        } else if (delivered.resume) {
          followUps.push(async () => {
            await resumeRun(runId);
          });
        }
      } catch (cause) {
        errors.push(toError(cause));
      }
    }

    const settled = await Promise.allSettled(followUps.map(async (followUp) => await followUp()));

    for (const result of settled) {
      if (result.status === "rejected") errors.push(toError(result.reason));
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, `${errors.length} workflow run(s) failed to receive event "${input.name}".`);
    }

    return reached;
  }

  /**
   * Resumes due runs page by page until `limit` of them were checked, with up to `concurrency`
   * running at once, so a run stuck in a step can't keep the next due run from starting. Runs whose
   * version this engine doesn't register are skipped without counting, so they can't hide later due
   * runs. A run in flight counts toward `limit` until it settles, so no more than `limit` run.
   */
  async function resumeDue(limit: number, concurrency: number): Promise<number> {
    if (!Number.isInteger(concurrency) || concurrency < 1) {
      throw new WorkflowError("invalid_definition", "resumeDue concurrency must be a positive integer.");
    }

    if (!(limit > 0)) return 0;

    const at = now();
    const errors: Error[] = [];
    const running = new Set<Promise<void>>();
    let queued: string[] = [];
    let cursor: string | undefined;
    let listedAll = false;
    let checked = 0;
    let resumed = 0;

    const nextId = async (): Promise<string | undefined> => {
      while (queued.length === 0 && !listedAll) {
        const page = await store.listDue(at, limit, cursor);

        queued = [...page.ids];
        cursor = page.cursor;
        listedAll = cursor === undefined;
      }

      return queued.shift();
    };

    const check = async (id: string) => {
      try {
        const result = await resumeRun(id);

        checked += 1;

        if (result.executed) resumed += 1;
      } catch (cause) {
        if (!(cause instanceof WorkflowError && cause.code === "workflow_not_registered")) checked += 1;

        errors.push(toError(cause));
      }
    };

    let exhausted = false;

    // Starts runs while a slot is free and `limit` leaves room. A settled run frees its slot, and an
    // unregistered one also gives its share of `limit` back.
    const fill = async () => {
      while (!exhausted && running.size < concurrency && checked + running.size < limit) {
        const id = await nextId();

        if (id === undefined) {
          exhausted = true;

          return;
        }

        const task: Promise<void> = check(id).finally(() => running.delete(task));

        running.add(task);
      }
    };

    await fill();

    while (running.size > 0) {
      await Promise.race(running);
      await fill();
    }

    if (errors.length > 0) throw new AggregateError(errors, `${errors.length} workflow run(s) failed to resume.`);

    return resumed;
  }

  return {
    async start(workflow, input, startOptions) {
      const definition = definitionFor({ workflow: workflow.name, version: workflow.version });

      if (definition !== workflow) {
        throw new WorkflowError(
          "workflow_not_registered",
          `The workflow passed to start is not the definition registered as ${definitionKey(workflow.name, workflow.version)}.`,
        );
      }

      // A repeated start returns the existing run before looking at its input, which is never used.
      // The create below still settles two concurrent first starts.
      const existing = startOptions?.id === undefined ? undefined : await store.get(startOptions.id);

      if (existing) return existing;

      let parsed: WorkflowJsonValue = input;

      if (workflow.input) {
        const validation = await workflow.input["~standard"].validate(input);

        if (validation.issues) {
          throw new WorkflowError(
            "invalid_input",
            `Invalid input for workflow ${workflow.name}: ${validation.issues.map((issue) => issue.message).join("; ")}`,
          );
        }

        parsed = validation.value;
      }

      assertJson(parsed, `The input of workflow ${workflow.name}`);

      const at = now();
      const owner = crypto.randomUUID();
      const lease: WorkflowLease = { owner, until: at + leaseMs };

      const run: WorkflowRun = {
        id: startOptions?.id ?? generateId(),
        workflow: workflow.name,
        version: workflow.version,
        status: "running",
        input: savedForm(parsed),
        journal: {},
        inbox: [],
        lease,
        revision: 0,
        createdAt: at,
        updatedAt: at,
        dueAt: lease.until,
      };

      if (startOptions?.subject !== undefined) run.subject = startOptions.subject;

      if (!(await store.create(run))) {
        const existing = await store.get(run.id);

        if (!existing) throw new WorkflowError("invalid_definition", `Run ${run.id} could not be created.`);

        return existing;
      }

      return (await execute(run, owner)) ?? run;
    },
    resume: async (runId) => (await resumeRun(runId)).run,
    resumeDue: async (resumeOptions) =>
      await resumeDue(resumeOptions?.limit ?? defaultResumeDueLimit, resumeOptions?.concurrency ?? defaultResumeDueConcurrency),
    sendEvent,
    async cancel(runId, reason = "canceled") {
      const run = await store.get(runId);

      if (!run || isTerminalRun(run)) return false;

      // A plain revision-checked write, independent of any execution: the owner's next save sees
      // the terminal run and stops before its next effect.
      return (await cancelRun(run, reason)) !== undefined;
    },
    get: (runId) => store.get(runId),
  };
}
