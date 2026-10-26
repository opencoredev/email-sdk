import type { EmailMessage, EmailSendOptions, EmailSendResult, MaybePromise } from "../types.js";

/** A value a workflow store can persist and replay unchanged. */
export type WorkflowJsonValue =
  | string
  | number
  | boolean
  | null
  | readonly WorkflowJsonValue[]
  | { readonly [key: string]: WorkflowJsonValue | undefined };

/**
 * A duration such as `"30s"`, `"15m"`, `"2h"`, `"3d"`, `"1w"`, `"500ms"`, or a number of
 * milliseconds.
 */
export type WorkflowDuration =
  | number
  | `${number}ms`
  | `${number}s`
  | `${number}m`
  | `${number}h`
  | `${number}d`
  | `${number}w`;

/** How often a failed `ctx.send` or `ctx.step` retries. Set on the engine, a workflow, or one step. */
export type WorkflowRetryPolicy = {
  /** Total attempts including the first. Defaults to 3. */
  maxAttempts?: number;
  /** Delay before the second attempt; doubles for each later attempt. Defaults to `"1m"`. */
  backoff?: WorkflowDuration;
};

/**
 * `running` while an execution holds the run, `waiting` on a sleep, retry, or event, and one of the
 * terminal states once it ends.
 */
export type WorkflowRunStatus = "running" | "waiting" | "completed" | "failed" | "canceled";

/** Which `ctx` call produced a journal entry: `send`, `step`, `sleep` (also `sleepUntil`), or `event`. */
export type WorkflowStepKind = "send" | "step" | "sleep" | "event";

/**
 * One journal entry, keyed by step name. A completed entry replays its `result`; a retrying entry
 * counts failed attempts of a send or step that will run again.
 */
export type WorkflowStepRecord =
  | {
      status: "completed";
      kind: WorkflowStepKind;
      result?: WorkflowJsonValue;
      completedAt: number;
    }
  | {
      status: "retrying";
      kind: "send" | "step";
      attempts: number;
      lastError: string;
    };

/**
 * What a waiting run is blocked on. `until` is when its timer is due; an event wait without `until`
 * has no timeout and waits until the event arrives or the run is canceled.
 */
export type WorkflowWait =
  | { kind: "sleep"; step: string; until: number }
  | { kind: "retry"; step: string; until: number }
  | { kind: "event"; step: string; event: string; until?: number };

/** Which execution holds a run, and until when. Expired leases may be claimed by any worker. */
export type WorkflowLease = { owner: string; until: number };

/**
 * A delivered event the run has not consumed yet. `receivedAt` is the delivering engine's clock time,
 * compared with the wait's deadline. The inbox keeps the newest 50 events.
 */
export type WorkflowInboxEvent = {
  name: string;
  payload?: WorkflowJsonValue;
  receivedAt: number;
};

/** The persisted state of one workflow run. Every field is JSON. */
export type WorkflowRun = {
  id: string;
  workflow: string;
  version: number;
  status: WorkflowRunStatus;
  input: WorkflowJsonValue;
  subject?: string;
  journal: Record<string, WorkflowStepRecord>;
  inbox: WorkflowInboxEvent[];
  wait?: WorkflowWait;
  output?: WorkflowJsonValue;
  error?: { message: string; step?: string };
  cancelReason?: string;
  /** Set while an execution owns the run. Every engine write that executes steps checks it. */
  lease?: WorkflowLease;
  revision: number;
  /**
   * When a resume is next due: the lease's `until` while the run is executing, so a crashed
   * worker's run is picked up again; otherwise the wait's `until`, or now when a delivered event
   * already satisfies the wait. Undefined for terminal runs and untimed event waits.
   */
  dueAt?: number;
  createdAt: number;
  updatedAt: number;
};

/** Persists run state. Implementations must make `create` and `save` atomic per run id. */
export type WorkflowStore = {
  get(id: string): Promise<WorkflowRun | undefined>;
  /** Inserts the run. Returns false, without writing, when a run with this id exists. */
  create(run: WorkflowRun): Promise<boolean>;
  /**
   * Replaces the run only when the stored revision equals `expectedRevision`. Returns false on a
   * conflict. The engine increments `run.revision` before calling this.
   */
  save(run: WorkflowRun, expectedRevision: number): Promise<boolean>;
  /** Non-terminal runs for a subject, used to route events and unsubscribes. */
  listActiveBySubject(subject: string): Promise<WorkflowRun[]>;
  /**
   * One page of at most `limit` ids of runs whose `dueAt` is at or before `now`, oldest due first.
   * Pass the returned `cursor` to read the next page; it is undefined on the last page.
   */
  listDue(now: number, limit: number, cursor?: string): Promise<WorkflowDuePage>;
};

/** A page of due run ids from `WorkflowStore.listDue`. `cursor` is set when more may follow. */
export type WorkflowDuePage = { ids: string[]; cursor?: string };

/** A wake for one run. `revision` is the run revision whose wait asked for it. */
export type WorkflowTimer = { runId: string; at: number; revision: number };

/**
 * Arranges for `engine.resume(runId)` to be called at or after `at`. The engine schedules a timer
 * for each wait's deadline and for each claim's lease expiry, which resumes a run whose worker
 * died. Timers are hints: resume ignores duplicate, early, and stale deliveries, and one that finds
 * the lease renewed schedules a new timer for the renewed expiry, so `cancel` may be best-effort. A
 * scheduler that keeps one timer per run must not let a timer replace one with a higher `revision`:
 * wakes can arrive out of order.
 */
export type WorkflowScheduler = {
  schedule(timer: WorkflowTimer): MaybePromise<void>;
  cancel(runId: string): MaybePromise<void>;
};

/** Source of the current time in epoch milliseconds. Defaults to `Date.now`. */
export type WorkflowClock = { now(): number };

/** Which run and step a `ctx.send` belongs to. A durable sender can record its sends per run. */
export type WorkflowSendContext = { runId: string; step: string };

/** The part of an EmailClient a workflow needs. An `EmailClient` ignores the third argument. */
export type WorkflowEmailSender = {
  send(message: EmailMessage, options?: EmailSendOptions, context?: WorkflowSendContext): Promise<EmailSendResult>;
};

/** Per-send options for `ctx.send`. The engine supplies the idempotency key, so it can't be set here. */
export type WorkflowSendOptions = Omit<EmailSendOptions, "idempotencyKey">;

/** What `ctx.send` journals and returns: the adapter that accepted the email and its provider id. */
export type WorkflowSendRecord = { adapter: string; id?: string };

/** What `ctx.waitForEvent` resolves with. `receivedAt` is when `sendEvent` was called. */
export type WorkflowEventResult<TPayload> =
  | { status: "received"; payload: TPayload; receivedAt: number }
  | { status: "timed_out" };

/** Options for `ctx.waitForEvent`. */
export type WorkflowWaitForEventOptions = {
  /** Event name to wait for. Defaults to the step name. */
  event?: string;
  /** Resolve with `{ status: "timed_out" }` after this long. Waits until canceled when omitted. */
  timeout?: WorkflowDuration;
};

/** Options for one `ctx.step`. Its `retry` overrides the workflow and engine policies. */
export type WorkflowStepOptions = { retry?: WorkflowRetryPolicy };

/**
 * The `ctx` passed to a workflow's `run`. Every call takes a step name that must be unique within the
 * run; finished steps return their journaled result on replay. The read-only fields stay the same
 * across replays.
 */
export type WorkflowContext = {
  readonly runId: string;
  readonly workflow: string;
  readonly version: number;
  readonly subject?: string;
  /** The run's `createdAt`, in epoch milliseconds. */
  readonly startedAt: number;
  /** Sends once per run and step name, with idempotency key `workflowIdempotencyKey(runId, name)`. */
  send(name: string, message: EmailMessage, options?: WorkflowSendOptions): Promise<WorkflowSendRecord>;
  /** Runs `fn` once and journals its JSON result. Retried per policy when it throws. */
  step<TResult extends WorkflowJsonValue | void>(
    name: string,
    fn: () => MaybePromise<TResult>,
    options?: WorkflowStepOptions,
  ): Promise<TResult>;
  /** Pauses the run for `duration`, measured from when the run first reaches this step. */
  sleep(name: string, duration: WorkflowDuration): Promise<void>;
  /** Pauses the run until an absolute time. A time in the past continues immediately. */
  sleepUntil(name: string, at: Date | number): Promise<void>;
  /**
   * Waits for an event sent to this run or its subject. An event delivered before the run gets here
   * is taken from the inbox. With `timeout`, an event received after the deadline loses to it.
   */
  waitForEvent<TPayload extends WorkflowJsonValue | undefined = undefined>(
    name: string,
    options?: WorkflowWaitForEventOptions,
  ): Promise<WorkflowEventResult<TPayload>>;
};

/**
 * Standard Schema v1 subset; zod 4, valibot, and arktype schemas satisfy it. `TInput` is what the
 * schema returns and `run` receives; `TStartInput` is what it accepts, which `start` takes. They
 * differ when the schema transforms values or fills defaults. Schemas declare both through
 * Standard Schema's `types`; without it, `start` takes `TInput`.
 */
export type WorkflowInputSchema<TInput, TStartInput = TInput> = {
  readonly "~standard": {
    readonly validate: (value: WorkflowJsonValue) => MaybePromise<
      | { readonly value: TInput; readonly issues?: undefined }
      | { readonly issues: ReadonlyArray<{ readonly message: string }> }
    >;
    readonly types?: { readonly input: TStartInput; readonly output: TInput } | undefined;
  };
};

/**
 * A workflow returned by `defineWorkflow`. Register it with `createWorkflowEngine({ workflows })`.
 * `TStartInput` is what `start` accepts, before the input schema parses it into `TInput`.
 */
export type WorkflowDefinition<
  TInput extends WorkflowJsonValue,
  TOutput extends WorkflowJsonValue | void,
  TStartInput extends WorkflowJsonValue = TInput,
> = {
  readonly name: string;
  readonly version: number;
  readonly cancelOn: readonly string[];
  readonly retry?: WorkflowRetryPolicy;
  readonly input?: WorkflowInputSchema<TInput, TStartInput>;
  run(ctx: WorkflowContext, input: TInput): Promise<TOutput>;
};

/**
 * A definition with its input erased, for registries. `run` is a method, so a definition with a
 * narrower input type stays assignable here.
 */
export type AnyWorkflowDefinition = WorkflowDefinition<WorkflowJsonValue, WorkflowJsonValue | void, WorkflowJsonValue>;

type WorkflowRunEvent = { run: WorkflowRun };

type WorkflowStepEvent = WorkflowRunEvent & { step: string; kind: WorkflowStepKind; attempt: number };

/**
 * Observers for run and step lifecycle events. Hooks can't change a run: each gets a copy of it,
 * and errors they throw are caught and ignored.
 */
export type WorkflowHooks = {
  onStepStart?: (event: WorkflowStepEvent) => MaybePromise<void>;
  onStepComplete?: (event: WorkflowStepEvent & { durationMs: number }) => MaybePromise<void>;
  onStepError?: (event: WorkflowStepEvent & { error: Error; willRetry: boolean }) => MaybePromise<void>;
  onRunComplete?: (event: WorkflowRunEvent) => MaybePromise<void>;
  onRunCanceled?: (event: WorkflowRunEvent & { reason: string }) => MaybePromise<void>;
  onRunFailed?: (event: WorkflowRunEvent & { error: Error }) => MaybePromise<void>;
};

/** Options for `createWorkflowEngine`. */
export type WorkflowEngineOptions = {
  /** Sends each `ctx.send`. An `EmailClient` works as is. */
  email: WorkflowEmailSender;
  store: WorkflowStore;
  /** Wakes runs when a wait ends. Without one, call `resumeDue` from a cron. */
  scheduler?: WorkflowScheduler;
  /** Every definition this engine may start or resume, including old versions with runs in flight. */
  workflows: readonly AnyWorkflowDefinition[];
  /** Defaults to `Date.now`. Event deadlines compare times from each worker's clock, so keep them in sync. */
  clock?: WorkflowClock;
  /** Default retry policy for every workflow. Workflow and step policies override it. */
  retry?: WorkflowRetryPolicy;
  hooks?: WorkflowHooks;
  /** Called for every recipient before a send. A true result cancels the run with reason `suppressed`. */
  isSuppressed?: (address: string) => MaybePromise<boolean>;
  /** Generates run ids when `start` gets none. Defaults to `crypto.randomUUID()`. */
  generateId?: () => string;
  /**
   * How long an execution holds a run before another worker may take it over. Renewed before
   * every step and, while a step runs, every third of this duration. Defaults to `"5m"`.
   */
  leaseDuration?: WorkflowDuration;
};

/** Options for `engine.start`. */
export type WorkflowStartOptions = {
  /** Deterministic ids make start idempotent: a second start returns the existing run. */
  id?: string;
  /** Routes `sendEvent({ subject })` to this run, usually the recipient address or user id. */
  subject?: string;
};

/** Options for `engine.resumeDue`. */
export type WorkflowResumeDueOptions = {
  /** How many due runs to check in this call. Defaults to 25; 0 or less checks none. */
  limit?: number;
  /** How many runs execute at once, a positive integer. Defaults to 10. */
  concurrency?: number;
};

/** An event for `engine.sendEvent`, addressed to one run by `runId` or to every active run of a `subject`. */
export type WorkflowEventInput = {
  name: string;
  payload?: WorkflowJsonValue;
} & ({ runId: string; subject?: never } | { subject: string; runId?: never });

/** The engine `createWorkflowEngine` returns. */
export type WorkflowEngine = {
  /**
   * Creates a run of exactly this definition and version, and executes it until its first wait or
   * the end. With an `id` that already exists, returns the stored run without validating `input` or
   * running anything. `input` is what the definition's schema accepts; the parsed value is stored.
   */
  start<TInput extends WorkflowJsonValue, TOutput extends WorkflowJsonValue | void, TStartInput extends WorkflowJsonValue>(
    workflow: WorkflowDefinition<TInput, TOutput, TStartInput>,
    input: NoInfer<TStartInput>,
    options?: WorkflowStartOptions,
  ): Promise<WorkflowRun>;
  /** Continues a run whose timer fired. Safe to call at any time; it no-ops when nothing is due. */
  resume(runId: string): Promise<WorkflowRun | undefined>;
  /**
   * Resumes every due run the store reports, for cron-driven hosts without a push scheduler.
   * Checks at most `limit` runs per call and runs up to `concurrency` of them at once, so a run
   * stuck in a step doesn't hold up the others. Runs whose version this engine doesn't register are
   * skipped without counting toward `limit`, and reported, with any other failures, in an
   * AggregateError after the rest ran. Returns how many runs it executed.
   */
  resumeDue(options?: WorkflowResumeDueOptions): Promise<number>;
  /**
   * Delivers an event, stamped with the time of this call, to every target, then resumes the runs it
   * satisfies concurrently. Returns the ids of the runs that saved the event. When a target fails,
   * the rest still get the event, and an AggregateError reports the failures. Delivery is at least
   * once: retrying after an AggregateError sends the event again to targets that already got it.
   */
  sendEvent(event: WorkflowEventInput): Promise<string[]>;
  /**
   * Cancels a run without waiting for a running step. A step or send already in flight may still
   * finish, but its result is discarded and nothing after it runs. Returns false when the run is
   * missing or already terminal.
   */
  cancel(runId: string, reason?: string): Promise<boolean>;
  /** Reads a run from the store. */
  get(runId: string): Promise<WorkflowRun | undefined>;
};
