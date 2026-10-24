import { EmailSdkError } from "../errors.js";
import { isStringMember } from "../internal/decode.js";
import type { EmailAddress, EmailMessage, MaybePromise, OneOrMany } from "../types.js";
import { durationToMs } from "./duration.js";
import { WorkflowError, WorkflowNonRetryableError } from "./errors.js";
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
  WorkflowRetryPolicy,
  WorkflowRun,
  WorkflowSendRecord,
  WorkflowStepRecord,
} from "./types.js";

const defaultRetry = { maxAttempts: 3, backoffMs: 60_000 };

const defaultLeaseMs = 5 * 60_000;

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

function withoutFirst(inbox: readonly WorkflowInboxEvent[], name: string): WorkflowInboxEvent[] {
  const index = inbox.findIndex((event) => event.name === name);

  return index === -1 ? [...inbox] : [...inbox.slice(0, index), ...inbox.slice(index + 1)];
}

function definitionKey(name: string, version: number) {
  return `${name}@${version}`;
}

/**
 * Creates a workflow engine over a store and scheduler. The engine itself is stateless apart from
 * per-run locks, so several engines (processes) may share one store; revision checks keep them safe.
 */
export function createWorkflowEngine(options: WorkflowEngineOptions): WorkflowEngine {
  const definitions = new Map<string, AnyWorkflowDefinition>();
  const latestVersion = new Map<string, number>();
  const { store, scheduler, email } = options;
  const hooks: WorkflowHooks = options.hooks ?? {};
  const now = () => (options.clock ? options.clock.now() : Date.now());
  const generateId = options.generateId ?? (() => crypto.randomUUID());
  const locks = new Map<string, Promise<void>>();

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

  async function withLock<T>(runId: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(runId) ?? Promise.resolve();
    const result = previous.then(task);

    const settled = result.then(
      () => undefined,
      () => undefined,
    );

    locks.set(runId, settled);

    try {
      return await result;
    } finally {
      if (locks.get(runId) === settled) locks.delete(runId);
    }
  }

  function dueAtFor(run: WorkflowRun, at: number): number | undefined {
    if (isTerminalRun(run)) return undefined;

    if (run.wait) return run.wait.until;

    return at + defaultLeaseMs;
  }

  /**
   * Applies `transform` and saves with a revision check. On a conflict it reloads and re-applies
   * the transform to the fresh state, so concurrent event deliveries are not lost. Returns
   * undefined when the run disappeared or became terminal in the meantime.
   */
  async function commit(base: WorkflowRun, transform: RunTransform): Promise<WorkflowRun | undefined> {
    let current = base;

    for (let attempt = 0; attempt < commitAttempts; attempt += 1) {
      const at = now();
      const next = transform(current);

      next.revision = current.revision + 1;
      next.updatedAt = at;
      next.dueAt = dueAtFor(next, at);

      if (await store.save(next, current.revision)) return next;

      const fresh = await store.get(base.id);

      if (!fresh || isTerminalRun(fresh)) return undefined;
      current = fresh;
    }

    return undefined;
  }

  async function scheduleWake(run: WorkflowRun) {
    if (run.wait?.until !== undefined) await scheduler?.schedule({ runId: run.id, at: run.wait.until });
  }

  async function cancelRun(run: WorkflowRun, reason: string): Promise<WorkflowRun | undefined> {
    const canceled = await commit(run, (current) => ({
      ...current,
      status: "canceled",
      cancelReason: reason,
      wait: undefined,
    }));

    if (!canceled) return undefined;
    await scheduler?.cancel(run.id);
    await invokeHook("onRunCanceled", { run: canceled, reason });

    return canceled;
  }

  /** Replays the run's definition until it completes, fails, or suspends on a wait. */
  async function execute(loaded: WorkflowRun): Promise<WorkflowRun | undefined> {
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

    async function save(transform: RunTransform): Promise<boolean> {
      const next = await commit(current, transform);

      if (!next) {
        lost = true;

        return false;
      }

      current = next;

      return true;
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
      const previous = current.journal[name];
      const attempt = (previous?.status === "retrying" ? previous.attempts : 0) + 1;
      const policy = resolveRetry(options.retry, definition.retry, retry);
      const startedAt = now();

      await invokeHook("onStepStart", { run: current, step: name, kind, attempt });

      let result: WorkflowJsonValue | void;

      try {
        result = await effect();
      } catch (cause) {
        const error = toError(cause);
        const willRetry = !isPermanentFailure(cause) && attempt < policy.maxAttempts;

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

      const stored = result ?? undefined;

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

    /** Completes the sleep once its persisted `until` has passed; otherwise waits and suspends. */
    async function sleepUntil(name: string, until: number) {
      const wait = current.wait;
      const target = wait?.kind === "sleep" && wait.step === name ? wait.until : until;

      if (target <= now()) {
        if (!(await save(withStep(name, { status: "completed", kind: "sleep", completedAt: now() })))) {
          return suspend();
        }

        return;
      }

      if (wait?.kind === "sleep" && wait.step === name) return suspend();

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
                const canceled = await cancelRun(current, "suppressed");

                if (canceled) current = canceled;
                else lost = true;

                return suspend();
              }
            }
          }

          const sent = await sideEffect(name, "send", undefined, async () => {
            const response = await email.send(message, {
              ...sendOptions,
              idempotencyKey: `wf:${loaded.id}:${name}`,
            });

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

          const eventName = waitOptions?.event ?? name;
          const delivered = current.inbox.find((event) => event.name === eventName);

          if (delivered) {
            const result: WorkflowEventResult<WorkflowJsonValue | undefined> = {
              status: "received",
              payload: delivered.payload,
              receivedAt: delivered.receivedAt,
            };

            const consumed = await save((run) => ({
              ...withStep(name, { status: "completed", kind: "event", result, completedAt: now() })(run),
              inbox: withoutFirst(run.inbox, eventName),
            }));

            if (!consumed) return suspend();

            // SAFETY: see the replay branch above; the payload type is the caller's declared contract.
            return result as WorkflowEventResult<never>;
          }

          const wait = current.wait;

          if (wait?.kind === "event" && wait.step === name) {
            if (wait.until === undefined || wait.until > now()) return suspend();

            const timedOut: WorkflowEventResult<never> = { status: "timed_out" };

            if (!(await save(withStep(name, { status: "completed", kind: "event", result: timedOut, completedAt: now() })))) {
              return suspend();
            }

            return timedOut;
          }

          const until = waitOptions?.timeout === undefined ? undefined : now() + durationToMs(waitOptions.timeout);

          const waiting = await save((run) => ({
            ...run,
            status: "waiting",
            wait: until === undefined ? { kind: "event", step: name, event: eventName } : { kind: "event", step: name, event: eventName, until },
          }));

          if (waiting) await scheduleWake(current);

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

      return lost ? await store.get(loaded.id) : current;
    }

    const output = outcome.output ?? undefined;
    const completed = await save((run) => ({ ...run, status: "completed", wait: undefined, output }));

    if (completed) await invokeHook("onRunComplete", { run: current });

    return lost ? await store.get(loaded.id) : current;
  }

  /** True when a resume should leave the run alone: terminal, not yet due, or held by a live worker. */
  function isIdle(run: WorkflowRun, at: number) {
    if (isTerminalRun(run)) return true;

    if (run.wait) return run.wait.until === undefined || run.wait.until > at;

    return run.dueAt !== undefined && run.dueAt > at;
  }

  async function resumeRun(runId: string) {
    return await withLock(runId, async () => {
      const run = await store.get(runId);

      if (!run || isIdle(run, now())) return run;

      return await execute(run);
    });
  }

  async function deliver(runId: string, name: string, payload: WorkflowJsonValue | undefined) {
    return await withLock(runId, async () => {
      const run = await store.get(runId);

      if (!run || isTerminalRun(run)) return false;

      const definition = definitionFor(run);

      if (definition.cancelOn.includes(name)) return (await cancelRun(run, `event:${name}`)) !== undefined;

      const event: WorkflowInboxEvent = payload === undefined ? { name, receivedAt: now() } : { name, payload, receivedAt: now() };

      const updated = await commit(run, (current) => {
        const awaiting = current.wait?.kind === "event" && current.wait.event === name;

        return {
          ...current,
          inbox: [...current.inbox, event].slice(-inboxLimit),
          status: awaiting ? "running" : current.status,
          wait: awaiting ? undefined : current.wait,
        };
      });

      if (!updated) return false;

      if (run.wait?.kind === "event" && run.wait.event === name) {
        if (run.wait.until !== undefined) await scheduler?.cancel(runId);
        await execute(updated);
      }

      return true;
    });
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

      const run: WorkflowRun = {
        id: startOptions?.id ?? generateId(),
        workflow: workflow.name,
        version: workflow.version,
        status: "running",
        input: parsed,
        journal: {},
        inbox: [],
        revision: 0,
        createdAt: at,
        updatedAt: at,
        dueAt: at + defaultLeaseMs,
      };

      if (startOptions?.subject !== undefined) run.subject = startOptions.subject;

      if (!(await store.create(run))) {
        const existing = await store.get(run.id);

        if (!existing) throw new WorkflowError("invalid_definition", `Run ${run.id} could not be created.`);

        return existing;
      }

      const result = await withLock(run.id, () => execute(run));

      return result ?? run;
    },
    resume: resumeRun,
    async resumeDue(limit = 25) {
      const ids = await store.listDue(now(), limit);
      const errors: Error[] = [];

      for (const id of ids) {
        try {
          await resumeRun(id);
        } catch (cause) {
          errors.push(toError(cause));
        }
      }

      if (errors.length > 0) throw new AggregateError(errors, `${errors.length} workflow run(s) failed to resume.`);

      return ids.length;
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
      return await withLock(runId, async () => {
        const run = await store.get(runId);

        if (!run || isTerminalRun(run)) return false;

        return (await cancelRun(run, reason)) !== undefined;
      });
    },
    get: (runId) => store.get(runId),
  };
}
