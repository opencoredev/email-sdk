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

export type WorkflowRetryPolicy = {
  /** Total attempts including the first. Defaults to 3. */
  maxAttempts?: number;
  /** Delay before the second attempt; doubles for each later attempt. Defaults to `"1m"`. */
  backoff?: WorkflowDuration;
};

export type WorkflowRunStatus = "running" | "waiting" | "completed" | "failed" | "canceled";

export type WorkflowStepKind = "send" | "step" | "sleep" | "event";

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

export type WorkflowWait =
  | { kind: "sleep"; step: string; until: number }
  | { kind: "retry"; step: string; until: number }
  | { kind: "event"; step: string; event: string; until?: number };

/** Which execution holds a run, and until when. Expired leases may be claimed by any worker. */
export type WorkflowLease = { owner: string; until: number };

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
  /** Ids of runs whose `dueAt` is at or before `now`. */
  listDue(now: number, limit: number): Promise<string[]>;
};

/** A wake for one run. `revision` is the run revision whose wait asked for it. */
export type WorkflowTimer = { runId: string; at: number; revision: number };

/**
 * Arranges for `engine.resume(runId)` to be called at or after `at`. Timers are hints: resume
 * ignores duplicate and stale deliveries, and an early one schedules a new timer for the run's
 * persisted `dueAt`, so `cancel` may be best-effort. A scheduler that keeps one timer per run must
 * not let a timer replace one with a higher `revision`: wakes can arrive out of order.
 */
export type WorkflowScheduler = {
  schedule(timer: WorkflowTimer): MaybePromise<void>;
  cancel(runId: string): MaybePromise<void>;
};

export type WorkflowClock = { now(): number };

/** The part of an EmailClient a workflow needs. */
export type WorkflowEmailSender = {
  send(message: EmailMessage, options?: EmailSendOptions): Promise<EmailSendResult>;
};

export type WorkflowSendOptions = Omit<EmailSendOptions, "idempotencyKey">;

export type WorkflowSendRecord = { adapter: string; id?: string };

export type WorkflowEventResult<TPayload> =
  | { status: "received"; payload: TPayload; receivedAt: number }
  | { status: "timed_out" };

export type WorkflowWaitForEventOptions = {
  /** Event name to wait for. Defaults to the step name. */
  event?: string;
  /** Resolve with `{ status: "timed_out" }` after this long. Waits until canceled when omitted. */
  timeout?: WorkflowDuration;
};

export type WorkflowStepOptions = { retry?: WorkflowRetryPolicy };

export type WorkflowContext = {
  readonly runId: string;
  readonly workflow: string;
  readonly version: number;
  readonly subject?: string;
  readonly startedAt: number;
  /** Sends once per run and step name, with idempotency key `workflowIdempotencyKey(runId, name)`. */
  send(name: string, message: EmailMessage, options?: WorkflowSendOptions): Promise<WorkflowSendRecord>;
  /** Runs `fn` once and journals its JSON result. Retried per policy when it throws. */
  step<TResult extends WorkflowJsonValue | void>(
    name: string,
    fn: () => MaybePromise<TResult>,
    options?: WorkflowStepOptions,
  ): Promise<TResult>;
  sleep(name: string, duration: WorkflowDuration): Promise<void>;
  sleepUntil(name: string, at: Date | number): Promise<void>;
  waitForEvent<TPayload extends WorkflowJsonValue | undefined = undefined>(
    name: string,
    options?: WorkflowWaitForEventOptions,
  ): Promise<WorkflowEventResult<TPayload>>;
};

/** Standard Schema v1 subset; zod 4, valibot, and arktype schemas satisfy it. */
export type WorkflowInputSchema<TInput> = {
  readonly "~standard": {
    readonly validate: (value: WorkflowJsonValue) => MaybePromise<
      | { readonly value: TInput; readonly issues?: undefined }
      | { readonly issues: ReadonlyArray<{ readonly message: string }> }
    >;
  };
};

export type WorkflowDefinition<TInput extends WorkflowJsonValue, TOutput extends WorkflowJsonValue | void> = {
  readonly name: string;
  readonly version: number;
  readonly cancelOn: readonly string[];
  readonly retry?: WorkflowRetryPolicy;
  readonly input?: WorkflowInputSchema<TInput>;
  run(ctx: WorkflowContext, input: TInput): Promise<TOutput>;
};

/**
 * A definition with its input erased, for registries. `run` is a method, so a definition with a
 * narrower input type stays assignable here.
 */
export type AnyWorkflowDefinition = WorkflowDefinition<WorkflowJsonValue, WorkflowJsonValue | void>;

type WorkflowRunEvent = { run: WorkflowRun };

type WorkflowStepEvent = WorkflowRunEvent & { step: string; kind: WorkflowStepKind; attempt: number };

export type WorkflowHooks = {
  onStepStart?: (event: WorkflowStepEvent) => MaybePromise<void>;
  onStepComplete?: (event: WorkflowStepEvent & { durationMs: number }) => MaybePromise<void>;
  onStepError?: (event: WorkflowStepEvent & { error: Error; willRetry: boolean }) => MaybePromise<void>;
  onRunComplete?: (event: WorkflowRunEvent) => MaybePromise<void>;
  onRunCanceled?: (event: WorkflowRunEvent & { reason: string }) => MaybePromise<void>;
  onRunFailed?: (event: WorkflowRunEvent & { error: Error }) => MaybePromise<void>;
};

export type WorkflowEngineOptions = {
  email: WorkflowEmailSender;
  store: WorkflowStore;
  scheduler?: WorkflowScheduler;
  workflows: readonly AnyWorkflowDefinition[];
  clock?: WorkflowClock;
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

export type WorkflowStartOptions = {
  /** Deterministic ids make start idempotent: a second start returns the existing run. */
  id?: string;
  /** Routes `sendEvent({ subject })` to this run, usually the recipient address or user id. */
  subject?: string;
};

export type WorkflowEventInput = {
  name: string;
  payload?: WorkflowJsonValue;
} & ({ runId: string; subject?: never } | { subject: string; runId?: never });

export type WorkflowEngine = {
  start<TInput extends WorkflowJsonValue, TOutput extends WorkflowJsonValue | void>(
    workflow: WorkflowDefinition<TInput, TOutput>,
    input: TInput,
    options?: WorkflowStartOptions,
  ): Promise<WorkflowRun>;
  /** Continues a run whose timer fired. Safe to call at any time; it no-ops when nothing is due. */
  resume(runId: string): Promise<WorkflowRun | undefined>;
  /**
   * Resumes every due run the store reports, for cron-driven hosts without a push scheduler.
   * Returns how many runs it executed.
   */
  resumeDue(limit?: number): Promise<number>;
  /** Delivers an event. Returns the ids of the runs it reached. */
  sendEvent(event: WorkflowEventInput): Promise<string[]>;
  /**
   * Cancels a run without waiting for a running step. A step or send already in flight may still
   * finish, but its result is discarded and nothing after it runs. Returns false when the run is
   * missing or already terminal.
   */
  cancel(runId: string, reason?: string): Promise<boolean>;
  get(runId: string): Promise<WorkflowRun | undefined>;
};
