import { EmailSdkError } from "../errors.js";
import { isStringMember } from "../internal/decode.js";
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

const commitAttempts = 5;

const neverSettles = new Promise<never>(() => {});

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

function isPermanentFailure(cause: unknown): boolean {
  return (
    cause instanceof WorkflowNonRetryableError ||
    cause instanceof WorkflowError ||
    (cause instanceof EmailSdkError && !cause.retryable)
  );
}

function addressOf(address: EmailAddress): string {
  if (!isStringMember(address)) return address.email.trim().toLowerCase();

  const bracketed = /<([^>]+)>/.exec(address);

  return (bracketed?.[1] ?? address).trim().toLowerCase();
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
      await handlers[name]?.(event);
    } catch {
      // Hooks are observability callbacks and never change run behavior.
    }
  }

  /**
   * Applies `transform` and saves with a revision check. On a conflict it reloads and re-applies
   * the transform to the fresh state, so concurrent event deliveries are not lost; transforms must
   * therefore decide from the run they are given. With an `owner`, every save renews that
   * execution's lease while the run is running and releases it once the run waits or ends, and the
   * commit gives up when the fresh run is held by someone else. Returns undefined when nothing was
   * saved: the transform declined, the run disappeared, became terminal, or changed owner.
   */
  async function commit(
    base: WorkflowRun,
    transform: (run: WorkflowRun) => WorkflowRun | undefined,
    owner?: string,
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

      if (owner !== undefined && fresh.lease?.owner !== owner) return undefined;
      current = fresh;
    }

    return undefined;
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

  async function cancelRun(run: WorkflowRun, reason: string, owner?: string): Promise<WorkflowRun | undefined> {
    const canceled = await commit(
      run,
      (current) => ({ ...current, status: "canceled", cancelReason: reason, wait: undefined }),
      owner,
    );

    if (!canceled) return undefined;
    await scheduler?.cancel(run.id);
    await invokeHook("onRunCanceled", { run: canceled, reason });

    return canceled;
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

    const seen = new Set<string>();
    let queue: Promise<void> = Promise.resolve();

    function suspend(): Promise<never> {
      stopped = true;
      signalSuspended();

      return neverSettles;
    }

    async function save(transform: (run: WorkflowRun) => WorkflowRun): Promise<boolean> {
      if (lost) return false;

      const next = await commit(current, transform, owner);

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

      if (seen.has(name)) {
        return Promise.reject(
          new WorkflowError(
            "duplicate_step",
            `Step "${name}" ran twice in workflow ${definitionKey(current.workflow, current.version)}. Step names must be unique per run; include a loop index in the name.`,
          ),
        );
      }

      seen.add(name);

      // Step failures are handled inside `body`. Anything that still escapes is a store, scheduler,
      // or suppression-check failure: the run's state is unknown, so the execution stops and the
      // error reaches the engine's caller instead of the definition.
      const result = queue.then(() =>
        stopped
          ? neverSettles
          : body().catch((cause: unknown) => {
              infrastructureError = toError(cause);

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

    async function failRun(error: Error, step?: string) {
      const failed = await save((run) => ({
        ...run,
        status: "failed",
        wait: undefined,
        error: step === undefined ? { message: error.message } : { message: error.message, step },
      }));

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

      const stored = jsonResult(result);

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
            return record.result as WorkflowSendRecord;
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
          return sent as WorkflowSendRecord;
        });
      },
      step(name, fn, stepOptions) {
        return operation(name, async () => {
          const record = completedRecord(name);
          const result = record ? record.result : await sideEffect(name, "step", stepOptions?.retry, async () => await fn());

          // SAFETY: the journaled value is what `fn` returned for this step name, persisted as JSON;
          // TResult is constrained to JSON values, so the round trip preserves its type.
          return result as Awaited<ReturnType<typeof fn>>;
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

          await sleepUntil(name, Number(at));
        });
      },
      waitForEvent(name, waitOptions) {
        return operation(name, async () => {
          const record = completedRecord(name);

          if (record) {
            // SAFETY: event steps journal a WorkflowEventResult. Event payloads are not parsed: the
            // caller's type argument states the payload contract, as it does for sendEvent.
            return record.result as WorkflowEventResult<never>;
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
            return outcome as WorkflowEventResult<never>;
          }

          await scheduleWake(current);

          return suspend();
        });
      },
    };

    const finished = definition.run(ctx, loaded.input).then(
      (output): ExecutionOutcome => ({ kind: "completed", output }),
      (cause: unknown): ExecutionOutcome => ({ kind: "failed", error: toError(cause) }),
    );

    const outcome = await Promise.race([finished, suspended]);

    // A `ctx` call the definition forgot to await may still be running; let it finish or suspend.
    if (outcome.kind !== "suspended") await Promise.race([queue, suspended]);

    if (infrastructureError) throw infrastructureError;

    if (outcome.kind === "suspended" || stopped) return lost ? await store.get(loaded.id) : current;

    stopped = true;

    if (outcome.kind === "failed") {
      await failRun(outcome.error);
    } else {
      const output = jsonResult(outcome.output);

      if (await save((run) => ({ ...run, status: "completed", wait: undefined, output }))) {
        await invokeHook("onRunComplete", { run: current });
      }
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

  async function deliver(runId: string, name: string, payload: WorkflowJsonValue | undefined) {
    const run = await store.get(runId);

    if (!run || isTerminalRun(run)) return false;

    const definition = definitionFor(run);

    if (definition.cancelOn.includes(name)) return (await cancelRun(run, `event:${name}`)) !== undefined;

    const event: WorkflowInboxEvent = payload === undefined ? { name, receivedAt: now() } : { name, payload, receivedAt: now() };

    // Delivery only appends to the inbox. The run's wait, including its deadline, stays as it is:
    // the execution that consumes the event compares `receivedAt` with that deadline.
    const updated = await commit(run, (current) => ({ ...current, inbox: [...current.inbox, event].slice(-inboxLimit) }));

    if (!updated) return false;

    if (updated.wait?.kind === "event" && updated.wait.event === name) await resumeRun(runId);

    return true;
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

      return (await execute(run, owner)) ?? run;
    },
    resume: async (runId) => (await resumeRun(runId)).run,
    async resumeDue(limit = 25) {
      const ids = await store.listDue(now(), limit);
      const errors: Error[] = [];
      let resumed = 0;

      for (const id of ids) {
        try {
          if ((await resumeRun(id)).executed) resumed += 1;
        } catch (cause) {
          errors.push(toError(cause));
        }
      }

      if (errors.length > 0) throw new AggregateError(errors, `${errors.length} workflow run(s) failed to resume.`);

      return resumed;
    },
    async sendEvent(event) {
      const targets =
        event.runId === undefined
          ? (await store.listActiveBySubject(event.subject)).map((run) => run.id)
          : [event.runId];

      const reached: string[] = [];

      for (const runId of targets) {
        if (await deliver(runId, event.name, event.payload)) reached.push(runId);
      }

      return reached;
    },
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
