import { WorkflowError } from "./errors.js";

// Journal keys are step names. Schema parsers drop an own `__proto__` key from a record, so a step
// with this name would lose its completed entry on the next read and run again.
const reservedStepName = "__proto__";

/** The `invalid_definition` error for a name no step may use, or undefined for a usable name. */
export function stepNameError(name: string): WorkflowError | undefined {
  if (name !== reservedStepName) return undefined;

  return new WorkflowError(
    "invalid_definition",
    `"${reservedStepName}" can't name a step: stores that parse the journal as a record, such as the Convex store, drop that key, so the step would run again on every wake.`,
  );
}

/**
 * The `invalid_definition` error for a `ctx` call made while step `activeStep` was still running.
 * The engine fails the run with it, and `inspectWorkflow` fails the path with the same message.
 */
export function stepOverlapError(name: string, activeStep: string): WorkflowError {
  return new WorkflowError(
    "invalid_definition",
    `"${name}" was called while step "${activeStep}" was still running. Await ctx.step before calling ctx again, and never call ctx from inside a step callback.`,
  );
}
