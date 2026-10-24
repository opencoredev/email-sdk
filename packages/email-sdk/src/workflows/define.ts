import { WorkflowError } from "./errors.js";
import type {
  WorkflowContext,
  WorkflowDefinition,
  WorkflowInputSchema,
  WorkflowJsonValue,
  WorkflowRetryPolicy,
} from "./types.js";

/** Options for `defineWorkflow`. */
export type DefineWorkflowOptions<
  TInput extends WorkflowJsonValue,
  TOutput extends WorkflowJsonValue | void,
  TStartInput extends WorkflowJsonValue = TInput,
> = {
  /** Stored on each run. Letters, digits, `_`, `-`, `.`, and `:` only. */
  name: string;
  /** Bump when a change would break in-flight runs, and keep the old version registered until they drain. */
  version?: number;
  /** Event names that cancel a run, such as `"unsubscribed"`. */
  cancelOn?: readonly string[];
  /** Default retry policy for this workflow's steps. */
  retry?: WorkflowRetryPolicy;
  /**
   * Parses input at `start`. `start` takes the schema's input type and `run` gets its output, so
   * transforms and defaults work. The parsed value is stored and replayed.
   */
  input?: WorkflowInputSchema<TInput, TStartInput>;
  /** The workflow body. Replayed from the top on every wake; its return value is saved as the run's `output`. */
  run: (ctx: WorkflowContext, input: TInput) => Promise<TOutput>;
};

const namePattern = /^[\w.:-]+$/;

/**
 * Defines a durable workflow. `run` is re-executed from the top every time the run wakes, and
 * completed steps return their journaled results, so code between `ctx` calls must be deterministic.
 */
export function defineWorkflow<
  TInput extends WorkflowJsonValue,
  TOutput extends WorkflowJsonValue | void = void,
  TStartInput extends WorkflowJsonValue = TInput,
>(options: DefineWorkflowOptions<TInput, TOutput, TStartInput>): WorkflowDefinition<TInput, TOutput, TStartInput> {
  if (!namePattern.test(options.name)) {
    throw new WorkflowError(
      "invalid_definition",
      `Workflow name "${options.name}" may only contain letters, digits, "_", "-", ".", and ":".`,
    );
  }

  const version = options.version ?? 1;

  if (!Number.isInteger(version) || version < 1) {
    throw new WorkflowError("invalid_definition", `Workflow "${options.name}" version must be a positive integer.`);
  }

  return {
    name: options.name,
    version,
    cancelOn: [...(options.cancelOn ?? [])],
    retry: options.retry,
    input: options.input,
    run: options.run,
  };
}
