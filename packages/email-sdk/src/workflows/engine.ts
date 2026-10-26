import { causeArray, causeBoolean, causeString } from "../internal/decode.js";
import { mailboxAddress } from "../internal/address.js";
import type { EmailAddress, EmailMessage, MaybePromise, OneOrMany } from "../types.js";
import { durationToMs } from "./duration.js";
import { WorkflowError, WorkflowNonRetryableError } from "./errors.js";
import { workflowIdempotencyKey } from "./idempotency.js";
import { compareLegacyRunOrder } from "./journal-order.js";
import { isTerminalRun } from "./memory.js";
import {
  assertEventPayload,
  assertStepResult,
  createWorkflowCallGuard,
  createWorkflowCallQueue,
  eventTimeoutMs,
  isDefinitionError,
  jsonResult,
  parseWorkflowInput,
  resolveRetry,
  savedForm,
  sleepMs,
  sleepUntilMs,
  workflowOutput,
} from "./rules.js";
import type { WorkflowFatalError } from "./rules.js";
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
  WorkflowWake,
} from "./types.js";

const defaultLease: WorkflowDuration = "5m";

// The default safety margin is a tenth of the lease, capped here so a long lease isn't distrusted
// for longer than clock skew between workers plausibly needs.
const maxDefaultLeaseMarginMs = 30_000;

const inboxLimit = 50;

const defaultResumeDueLimit = 25;

const defaultResumeDueConcurrency = 10;

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

type ExecutionOutcome =
  | { kind: "completed"; output: WorkflowJsonValue | void }
  | { kind: "failed"; error: Error }
  | { kind: "suspended" };

type RunTransform = (run: WorkflowRun) => WorkflowRun;

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
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

/** A copy of a run for a hook, so a hook that edits what it was given can't change the next save. */
function detached(run: WorkflowRun): WorkflowRun {
  return structuredClone(run);
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

function highestSequence(journal: WorkflowRun["journal"]) {
  return Math.max(0, ...Object.values(journal).map((record) => record.sequence ?? 0));
}

/**
 * The journal with every entry numbered. A journal saved before `sequence` existed numbers its
 * entries in run order, after any already numbered, so no two entries share a number.
 */
function numberedJournal(journal: WorkflowRun["journal"]): WorkflowRun["journal"] {
  const unnumbered = Object.entries(journal)
    .filter(([, record]) => record.sequence === undefined)
    .toSorted(([, a], [, b]) => compareLegacyRunOrder(a, b));

  if (unnumbered.length === 0) return journal;

  const base = highestSequence(journal);

  return {
    ...journal,
    ...Object.fromEntries(unnumbered.map(([name, record], index) => [name, { ...record, sequence: base + index + 1 }])),
  };
}

/** The journal with `record` saved as step `name`, numbered in the order steps first appeared. */
function journalWith(journal: WorkflowRun["journal"], name: string, record: WorkflowStepRecord): WorkflowRun["journal"] {
  const numbered = numberedJournal(journal);
  const sequence = numbered[name]?.sequence ?? highestSequence(numbered) + 1;

  return { ...numbered, [name]: { ...record, sequence } };
}

function definitionKey(name: string, version: number) {
  return `${name}@${version}`;
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

  const leaseMarginMs =
    options.leaseSafetyMargin === undefined
      ? Math.min(maxDefaultLeaseMarginMs, Math.floor(leaseMs / 10))
      : durationToMs(options.leaseSafetyMargin);

  if (leaseMarginMs >= leaseMs) {
    throw new WorkflowError("invalid_definition", "leaseSafetyMargin must be less than leaseDuration.");
  }

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
   * the newer one.
   */
  async function scheduleWake(run: WorkflowRun) {
    if (run.wait?.until !== undefined) {
      await scheduler?.schedule({ runId: run.id, at: run.wait.until, revision: run.revision });
    }
  }

  /**
   * Schedules a wake for when the lease of the execution that just claimed the run expires, so a
   * run whose worker dies mid-step resumes without a `resumeDue` poll. The claim is the run's newest
   * revision, so this wake never displaces a newer one, and the wake of a wait the execution saves
   * later displaces it. The wake names the claim's owner: one that finds that claim's lease renewed
   * re-arms in `resumeRun`, and one that finds a later claim holding the run stops there.
   */
  async function scheduleRecovery(run: WorkflowRun) {
    if (run.lease) {
      await scheduler?.schedule({ runId: run.id, at: run.lease.until, revision: run.revision, owner: run.lease.owner });
    }
  }

  function canceledBy(reason: string): RunTransform {
    return (run) => ({ ...run, status: "canceled", cancelReason: reason, wait: undefined });
  }

  /** Saves the cancellation. Returns undefined when the run had already ended. */
  async function saveCancellation(run: WorkflowRun, reason: string): Promise<WorkflowRun | undefined> {
    return await commit(run, canceledBy(reason));
  }

  /** What follows a saved cancellation: dropping the run's timer and telling `onRunCanceled`. */
  async function afterCancellation(canceled: WorkflowRun, reason: string) {
    await scheduler?.cancel(canceled.id);
    await invokeHook("onRunCanceled", { run: canceled, reason });
  }

  async function cancelRun(run: WorkflowRun, reason: string): Promise<WorkflowRun | undefined> {
    const canceled = await saveCancellation(run, reason);

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
    // Set once `execute` returns or throws. Nothing the execution left in flight, such as a step
    // callback that settles later or its heartbeat, may save after that.
    let ended = false;
    let infrastructureError: Error | undefined;
    let signalSuspended: () => void = () => {};

    let signalFatal: (fatal: WorkflowFatalError) => void = () => {};

    const suspended = new Promise<ExecutionOutcome>((resolve) => {
      signalSuspended = () => resolve({ kind: "suspended" });
    });

    // Settles with the first definition error, such as an overlapping call, so the run fails
    // without waiting for a step that was running: its callback may never settle, and its
    // heartbeat would hold the run meanwhile.
    const doomed = new Promise<ExecutionOutcome>((resolve) => {
      signalFatal = (fatal) => resolve({ kind: "failed", error: fatal.error });
    });

    // The rules for this execution's `ctx` calls. They belong to this execution, so a step
    // callback may still start or resume other runs.
    const guard = createWorkflowCallGuard((fatal) => signalFatal(fatal));

    // What suspended `ctx` calls await. It belongs to this execution, so once the execution is
    // over nothing references the abandoned workflow call and the garbage collector can free it.
    const neverSettles = new Promise<never>(() => {});
    // This execution's saves, one at a time, so each starts from the run the last one saved. A
    // failure saved while a sibling call is still saving its wait then sees that wait.
    let saving: Promise<unknown> = Promise.resolve();
    const heartbeats = new Set<() => void>();

    function suspend(): Promise<never> {
      stopped = true;
      signalSuspended();

      return neverSettles;
    }

    async function saveNow(
      transform: (run: WorkflowRun) => WorkflowRun,
      adopts?: (fresh: WorkflowRun, base: WorkflowRun) => boolean,
    ): Promise<boolean> {
      // Once this execution has ended the run, nothing it still has in flight, such as a step
      // callback that outlived the failure or its heartbeat, may write again.
      if (ended || lost || isTerminalRun(current)) return false;

      const base = current;
      const next = await commit(base, transform, owner, adopts && ((fresh) => adopts(fresh, base)));

      if (!next) {
        lost = true;

        return false;
      }

      current = next;

      if (isTerminalRun(next)) {
        for (const stop of heartbeats) stop();
      }

      // A save of a running run renewed the lease from a clock reading taken before it was sent. A
      // reply that comes back once that lease may have lapsed proves nothing: another worker may
      // already hold the run, so this execution stops as if it had lost it.
      if (next.status === "running" && !leaseHeld()) {
        lost = true;

        return false;
      }

      return true;
    }

    function save(
      transform: (run: WorkflowRun) => WorkflowRun,
      adopts?: (fresh: WorkflowRun, base: WorkflowRun) => boolean,
    ): Promise<boolean> {
      const saved = saving.then(async () => await saveNow(transform, adopts));

      saving = saved.catch(() => undefined);

      return saved;
    }

    /**
     * True while the lease this execution last wrote is safely its own: `commit` set its expiry from
     * the clock reading taken just before the write was sent, and the safety margin comes off that.
     * Neither the store's view nor the reply's arrival time can extend it.
     */
    function leaseHeld() {
      return current.lease?.owner === owner && now() < current.lease.until - leaseMarginMs;
    }

    /** Proves this execution still owns an active run, and extends the lease, before an effect. */
    function renew() {
      return save((run) => ({ ...run }));
    }

    /**
     * Runs `body` while renewing the lease every third of its duration. The timer stops as soon as
     * a renewal shows the run was canceled, finished, or taken over, or this execution ends the run,
     * even if `body` never settles. A renewal that throws (a store outage) keeps the timer, since
     * the lease may still be held.
     */
    async function withHeartbeat<T>(body: () => Promise<T>): Promise<T> {
      let beat: Promise<unknown> = Promise.resolve();

      const timer = setInterval(() => {
        beat = beat
          .then(renew)
          .catch(() => true)
          .then((owned) => {
            if (!owned) stop();
          });
      }, Math.max(1, Math.floor(leaseMs / 3)));

      const stop = () => {
        clearInterval(timer);
        heartbeats.delete(stop);
      };

      heartbeats.add(stop);

      try {
        return await body();
      } finally {
        stop();
        await beat;
      }
    }

    // Step failures are handled inside each call's body. A definition error, such as a negative
    // duration, fails the run: replaying it would only throw again. Anything else that escapes is a
    // store, scheduler, or suppression-check failure: the run's state is unknown, so the execution
    // stops and the error reaches the engine's caller instead of the definition.
    const calls = createWorkflowCallQueue({
      guard,
      workflow: definitionKey(loaded.workflow, loaded.version),
      halted: () => stopped,
      parked: neverSettles,
      onFailure: (cause) => {
        infrastructureError = toError(cause);

        return suspend();
      },
    });

    /**
     * True while this execution may still start work for a call. A sibling's rejection can fail the
     * run during any await of a call's body, so the body checks this after each one and parks once
     * it is false: no effect, hook, or wake starts for a run this execution is failing or lost.
     */
    function live() {
      return calls.open && !ended && !lost && !isTerminalRun(current);
    }

    /** Awaits `pending` for a call's body, then parks the call unless the execution is still live. */
    async function whileLive<T>(pending: MaybePromise<T>): Promise<T> {
      const value = await pending;

      return live() ? value : await suspend();
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
        journal: journalWith(run.journal, name, record),
      });
    }

    async function failRun(error: Error, step?: string, adopts?: (fresh: WorkflowRun, base: WorkflowRun) => boolean) {
      const failed = await save(
        (run) => ({
          ...run,
          status: "failed",
          wait: undefined,
          error: step === undefined ? { message: error.message } : { message: error.message, step },
        }),
        adopts,
      );

      if (!failed) return;

      // A failed run never wakes again, so its lease-expiry wake would only fire into nothing.
      await scheduler?.cancel(current.id);
      await invokeHook("onRunFailed", { run: current, error });
    }

    async function sideEffect(
      name: string,
      kind: "send" | "step",
      retry: WorkflowRetryPolicy | undefined,
      effect: () => Promise<WorkflowJsonValue | void>,
    ): Promise<WorkflowJsonValue | undefined> {
      if (!(await renew()) || !live()) return suspend();

      const previous = current.journal[name];
      const attempt = (previous?.status === "retrying" ? previous.attempts : 0) + 1;
      const policy = resolveRetry(options.retry, definition.retry, retry);
      const startedAt = now();

      if (hooks.onStepStart) {
        await whileLive(invokeHook("onStepStart", { run: current, step: name, kind, attempt }));

        // The hook may have taken any amount of time, and the run may have been canceled
        // meanwhile. Ownership must be proven after the last await before the effect starts.
        if (!(await renew())) return suspend();
      }

      // The admission check, in the same synchronous turn that starts the effect: a sibling that
      // fails the run, or a lease that lapsed while the renewal's reply was on its way, stops it
      // here. Nothing may await between this line and the effect's first line, and `withHeartbeat`
      // calls the effect synchronously.
      if (!live() || !leaseHeld()) return suspend();

      let result: WorkflowJsonValue | void;

      try {
        result = await withHeartbeat(effect);
      } catch (cause) {
        const error = toError(cause);
        const willRetry = !isPermanentFailure(cause) && attempt < policy.maxAttempts;

        // A run this execution is failing or already failed, as when `run` rejected beside this
        // step, stays failed.
        if (!live()) return suspend();

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
          journal: journalWith(run.journal, name, { status: "retrying", kind, attempts: attempt, lastError: error.message }),
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

      // A failure saved behind this wait cancels the run's timer, so a stopped execution sets none.
      if (await save((run) => ({ ...run, status: "waiting", wait: { kind: "sleep", step: name, until: target } }))) {
        if (live()) await scheduleWake(current);
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
        return calls.enqueue(name, async () => {
          const record = completedRecord(name);

          if (record) {
            // SAFETY: this journal entry was written from the WorkflowSendRecord this same step
            // returned on an earlier execution; send steps only ever journal that record.
            return savedForm(record.result as WorkflowSendRecord);
          }

          if (options.isSuppressed) {
            for (const address of recipientsOf(message)) {
              if (await whileLive(options.isSuppressed(address))) {
                if (await save(canceledBy("suppressed"))) await afterCancellation(current, "suppressed");

                return suspend();
              }
            }
          }

          const idempotencyKey = await whileLive(workflowIdempotencyKey(loaded.id, name));

          const sent = await sideEffect(name, "send", undefined, async () => {
            const response = await email.send(message, { ...sendOptions, idempotencyKey }, { runId: loaded.id, step: name });
            const sendRecord: WorkflowSendRecord = { adapter: response.adapter };

            if (response.id !== undefined) sendRecord.id = response.id;

            return sendRecord;
          });

          // SAFETY: sideEffect returns exactly the WorkflowSendRecord the effect above produced.
          return savedForm(sent as WorkflowSendRecord);
        });
      },
      step(name, fn, stepOptions) {
        return calls.enqueue(
          name,
          async () => {
          const record = completedRecord(name);

          const result = record
            ? record.result
            : await sideEffect(name, "step", stepOptions?.retry, async () => {
                // `fn` starts synchronously, in the turn that proved the execution live.
                const value = await new Promise<WorkflowJsonValue | void>((resolve) => {
                  resolve(fn());
                }).catch((cause: unknown) => {
                  throw guard.fatal?.error ?? cause;
                });

                // A callback that caught its own rejected `ctx` call still fails the run.
                if (guard.fatal) throw guard.fatal.error;

                assertStepResult(name, value);

                return value;
              });

          // SAFETY: the journaled value is what `fn` returned for this step name, persisted as JSON;
          // TResult is constrained to JSON values, so the round trip preserves its type.
          return savedForm(result as Awaited<ReturnType<typeof fn>>);
          },
          { step: true },
        );
      },
      sleep(name, duration: WorkflowDuration) {
        return calls.enqueue(name, async () => {
          if (completedRecord(name)) return;

          await sleepUntil(name, now() + sleepMs(duration));
        });
      },
      sleepUntil(name, at) {
        return calls.enqueue(name, async () => {
          if (completedRecord(name)) return;

          await sleepUntil(name, sleepUntilMs(name, at));
        });
      },
      waitForEvent(name, waitOptions) {
        return calls.enqueue(name, async () => {
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
          const timeoutMs = persisted ? undefined : eventTimeoutMs(waitOptions?.timeout);
          const until = persisted ? persisted.until : timeoutMs === undefined ? undefined : now() + timeoutMs;

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

          if (live()) await scheduleWake(current);

          return suspend();
        });
      },
    };

    /** Runs the definition to an outcome and saves it. */
    async function conclude(): Promise<WorkflowRun | undefined> {
      // Starting inside `then` turns a synchronous throw from `run` into a failed outcome.
      const finished = Promise.resolve()
        .then(async () => await definition.run(ctx, savedForm(loaded.input)))
        .then(
        (output): ExecutionOutcome => ({ kind: "completed", output }),
        (cause: unknown): ExecutionOutcome => ({ kind: "failed", error: toError(cause) }),
      );

      let outcome = await Promise.race([finished, suspended, doomed]);

      // Every queued microtask runs before a timer does, so one timer turn lets a rejection already
      // on its way, such as a rejected sibling in `Promise.all` beside `ctx.waitForEvent`, settle
      // `run` before the execution counts as suspended. A rejection behind real I/O or a timer
      // arrives later and is replayed on the run's next wake.
      if (outcome.kind === "suspended") outcome = await settledWithinTurn(finished, outcome);

      // A `ctx` call the definition forgot to await may still be running; let it finish or suspend.
      // A failed run doesn't wait: the queue may hold a step whose callback never settles, and
      // whatever it still has in flight can't save once the failure has.
      if (outcome.kind === "completed") await Promise.race([calls.idle, suspended, doomed]);

      if (infrastructureError) throw infrastructureError;

      // The first definition error, such as a call that overlapped a running step, fails the run even
      // if the definition caught it and went on to finish or park on a wait.
      const fatal = guard.fatal;

      if (fatal) outcome = { kind: "failed", error: fatal.error };

      // A sibling `ctx` call may have saved a wait after `run` rejected, as with a rejected promise in
      // `Promise.all` beside `ctx.waitForEvent`. The rejection still fails the run. A stop that ended
      // the run itself (a cancel, a failed step, a lost lease) stands.
      const failedBesideWait = outcome.kind === "failed" && !lost && !isTerminalRun(current);

      if (outcome.kind === "suspended" || (stopped && !failedBesideWait)) {
        return lost ? await store.get(loaded.id) : current;
      }

      stopped = true;

      if (outcome.kind === "failed") {
        // A wait a sibling saved has released the run, so another engine's write, such as an event
        // delivery, may land before the failure. The failure still wins while the run stands where
        // this execution parked it; a run another execution claimed is left to that execution.
        await failRun(outcome.error, fatal?.step, (fresh, base) => isParkedAt(fresh, base));
      } else {
        let output: WorkflowJsonValue | undefined;
        let invalid: WorkflowError | undefined;

        try {
          output = workflowOutput(outcome.output);
        } catch (cause) {
          if (!isDefinitionError(cause)) throw cause;

          invalid = cause;
        }

        if (invalid) await failRun(invalid);
        else if (await save((run) => ({ ...run, status: "completed", wait: undefined, output }))) {
          await invokeHook("onRunComplete", { run: current });
        }
      }

      if (!lost) await scheduler?.cancel(loaded.id);

      return lost ? await store.get(loaded.id) : current;
    }

    // Every exit, including a final save that throws, stops the heartbeats of steps still running.
    // A run left unsaved then keeps its last lease, which expires so lease-expiry recovery can retry it.
    try {
      // A claim whose reply came back after its lease may have lapsed holds nothing, like a late renewal.
      if (!leaseHeld()) {
        lost = true;

        return await store.get(loaded.id);
      }

      return await conclude();
    } finally {
      ended = true;

      for (const stop of heartbeats) stop();
    }
  }

  /** Claims and executes the run when it is runnable. `executed` is false when it was left alone. */
  async function resumeRun(runId: string, wake?: WorkflowWake): Promise<{ run: WorkflowRun | undefined; executed: boolean }> {
    const run = await store.get(runId);

    if (!run || !isRunnable(run, now())) {
      // A wake that finds an execution still holding the run, because it renewed the lease after
      // the wake was scheduled, re-arms for the renewed expiry. A lease-expiry wake left by an
      // earlier claim doesn't: the holder's own wake already watches the lease, and a scheduler
      // that keeps every job, as Convex does, would otherwise run one chain per earlier claim. A
      // waiting run already has the wake its parking save scheduled, so it is never re-armed.
      const lease = run?.lease;
      const watches = wake?.owner === undefined || wake.owner === lease?.owner;

      if (run && lease !== undefined && lease.until > now() && watches) {
        await scheduler?.schedule({ runId: run.id, at: lease.until, revision: run.revision, owner: lease.owner });
      }

      return { run, executed: false };
    }

    // Resolve the definition before writing, so a missing version leaves the run untouched.
    definitionFor(run);

    const claimed = await claim(run);

    if (!claimed) return { run: await store.get(runId), executed: false };

    await scheduleRecovery(claimed.run);

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
    assertEventPayload(input.name, input.payload);

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

      const parsed = await parseWorkflowInput(workflow, input);

      const at = now();
      const owner = crypto.randomUUID();
      const lease: WorkflowLease = { owner, until: at + leaseMs };

      const run: WorkflowRun = {
        id: startOptions?.id ?? generateId(),
        workflow: workflow.name,
        version: workflow.version,
        status: "running",
        input: parsed,
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

      await scheduleRecovery(run);

      return (await execute(run, owner)) ?? run;
    },
    resume: async (runId, wake) => (await resumeRun(runId, wake)).run,
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
