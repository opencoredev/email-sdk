import { isBoolean, isNumber, isObjectLike, isString } from "../internal/decode.js";
import { durationToMs } from "./duration.js";
import { WorkflowError } from "./errors.js";
import { stepNameError, stepOverlapError } from "./step-name.js";
import type { AnyWorkflowDefinition, WorkflowDuration, WorkflowJsonValue, WorkflowRetryPolicy } from "./types.js";

/*
 * What a definition may do, shared by the engine and `inspectWorkflow` so the two can't disagree:
 * how start input is parsed, which values count as JSON, how durations, dates, and timeouts are
 * read, and which `ctx` calls are allowed. The engine adds the journal, store, and effects around
 * these rules; the inspector adds the graph.
 */

// Mistakes in how a definition calls `ctx`, which fail the run instead of reaching the caller.
const definitionErrorCodes = new Set(["invalid_definition", "invalid_duration", "invalid_value"]);

/** A WorkflowError caused by the definition's own `ctx` call, such as a negative duration. */
export function isDefinitionError(cause: unknown): cause is WorkflowError {
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
export function isJsonValue(value: WorkflowJsonValue, ancestors: readonly object[] = []): boolean {
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
export function assertJson(value: WorkflowJsonValue | void, what: string) {
  if (value !== undefined && !isJsonValue(value)) {
    throw new WorkflowError("invalid_value", `${what} must be JSON: finite numbers, strings, booleans, null, arrays, and plain objects.`);
  }
}

/**
 * The value as a store gives it back: a fresh JSON round trip, with no shared references and no
 * `undefined` object fields. Workflow code gets this form on the first execution as well as on
 * replay, so a wake can't change what it sees, and editing it can't change the journal.
 */
export function savedForm<T extends WorkflowJsonValue | void>(value: T): T {
  // SAFETY: callers pass values that passed `isJsonValue` or came from the store, so the round trip
  // yields the same JSON value; only `undefined` fields, which T allows to be absent, are dropped.
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

/** The stored step result, or the workflow output, with `undefined` (a `void` return) left out. */
export function jsonResult(value: WorkflowJsonValue | void): WorkflowJsonValue | undefined {
  return value === undefined ? undefined : value;
}

/**
 * Start input as `run` first sees it: the original input checked by the definition's schema, the
 * schema's result checked as JSON, then saved. Throws `invalid_input` or `invalid_value`.
 */
export async function parseWorkflowInput(definition: AnyWorkflowDefinition, input: WorkflowJsonValue): Promise<WorkflowJsonValue> {
  let parsed: WorkflowJsonValue = input;

  if (definition.input) {
    const validation = await definition.input["~standard"].validate(input);

    if (validation.issues) {
      throw new WorkflowError(
        "invalid_input",
        `Invalid input for workflow ${definition.name}: ${validation.issues.map((issue) => issue.message).join("; ")}`,
      );
    }

    parsed = validation.value;
  }

  assertJson(parsed, `The input of workflow ${definition.name}`);

  return savedForm(parsed);
}

/** The output `run` returned, saved, or `invalid_value` when it isn't JSON. */
export function workflowOutput(output: WorkflowJsonValue | void): WorkflowJsonValue | undefined {
  const result = jsonResult(output);

  if (!isJsonValue(result ?? null)) throw new WorkflowError("invalid_value", "The workflow output must be JSON.");

  return savedForm(result);
}

/** A step's result, or `invalid_value` when it isn't JSON. */
export function assertStepResult(name: string, value: WorkflowJsonValue | void) {
  assertJson(value, `The result of step "${name}"`);
}

/** A payload `sendEvent` delivers, or an event sample `inspectWorkflow` uses. Throws `invalid_value`. */
export function assertEventPayload(event: string, payload: WorkflowJsonValue | undefined) {
  assertJson(payload, `The payload of event "${event}"`);
}

const defaultRetry = { maxAttempts: 3, backoffMs: 60_000 };

export type ResolvedRetry = { maxAttempts: number; backoffMs: number };

/**
 * The retry policy a `ctx.send` or `ctx.step` runs under: each policy overrides the fields the one
 * before it sets, from the engine's default to the call's own. Throws `invalid_definition` for an
 * attempt count that isn't a positive integer and `invalid_duration` for a bad backoff.
 */
export function resolveRetry(...policies: (WorkflowRetryPolicy | undefined)[]): ResolvedRetry {
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

/** How long `ctx.sleep` waits, in milliseconds. Throws `invalid_duration`. */
export function sleepMs(duration: WorkflowDuration): number {
  return durationToMs(duration);
}

/** The epoch milliseconds `ctx.sleepUntil` waits for. Throws `invalid_duration`. */
export function sleepUntilMs(name: string, at: Date | number): number {
  const until = Number(at);

  if (!Number.isFinite(until)) {
    throw new WorkflowError("invalid_duration", `sleepUntil "${name}" needs a valid Date or epoch milliseconds.`);
  }

  return until;
}

/** The `ctx.waitForEvent` timeout in milliseconds, if it has one. Throws `invalid_duration`. */
export function eventTimeoutMs(timeout: WorkflowDuration | undefined): number | undefined {
  return timeout === undefined ? undefined : durationToMs(timeout);
}

/** What the guard says about a `ctx` call: go ahead, or stop, since an earlier error doomed the run. */
export type WorkflowCallAdmission = "proceed" | "halt";

/** The definition error that ended the run, and the step it was raised for, if any. */
export type WorkflowFatalError = { error: WorkflowError; step?: string };

/**
 * The `ctx` call rules for one execution: unique, usable step names, and no `ctx` call while a
 * `ctx.step` is running. The first definition error, a reused step name included, is fatal even
 * when the definition catches it: it is latched, `onFatal` hears about it once, and every later
 * call is told to halt. A definition that catches errors in a loop therefore parks instead of
 * spinning on.
 */
export type WorkflowCallGuard = {
  /**
   * Checks a call before it runs. Returns `halt` once the run is doomed. Throws the error for the
   * call that breaks a rule, latching it first when it is a definition error.
   */
  admit(name: string, workflow: string): WorkflowCallAdmission;
  /** Marks `name` as the running step until `pending` settles. */
  stepStarted(name: string, pending: Promise<unknown>): void;
  /** Latches a definition error raised while running a call. The first one wins. */
  latch(error: WorkflowError, step?: string): void;
  readonly fatal: WorkflowFatalError | undefined;
};

export function createWorkflowCallGuard(onFatal: (fatal: WorkflowFatalError) => void): WorkflowCallGuard {
  const seen = new Set<string>();
  // Names the step from the `ctx.step` call until its promise settles. Every other `ctx` call
  // made meanwhile fails: from inside the callback it would queue behind the step that awaits
  // it, and telling a call from inside the callback apart from a sibling `run` made needs async
  // context tracking, which isn't portable across runtimes. Siblings never ran in parallel, so
  // they lose nothing. Overlapping calls that involve no step, such as two sends, still queue.
  let activeStep: string | undefined;
  let fatal: WorkflowFatalError | undefined;

  function latch(error: WorkflowError, step?: string) {
    if (fatal) return;

    fatal = step === undefined ? { error } : { error, step };
    onFatal(fatal);
  }

  return {
    get fatal() {
      return fatal;
    },
    latch,
    admit(name, workflow) {
      if (fatal) return "halt";

      const broken = activeStep === undefined ? stepNameError(name) : stepOverlapError(name, activeStep);

      if (broken) {
        latch(broken);

        throw broken;
      }

      if (seen.has(name)) {
        const duplicate = new WorkflowError(
          "duplicate_step",
          `Step "${name}" ran twice in workflow ${workflow}. Step names must be unique per run; include a loop index in the name.`,
        );

        latch(duplicate);

        throw duplicate;
      }

      seen.add(name);

      return "proceed";
    },
    stepStarted(name, pending) {
      activeStep = name;

      const release = () => {
        if (activeStep === name) activeStep = undefined;
      };

      pending.then(release, release);
    },
  };
}
