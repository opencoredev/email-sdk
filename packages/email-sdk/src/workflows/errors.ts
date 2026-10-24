export type WorkflowErrorCode =
  | "invalid_definition"
  | "invalid_duration"
  | "invalid_input"
  | "duplicate_step"
  | "workflow_not_registered"
  | "step_failed";

/** Errors the workflow engine raises about definitions, input, and registration. */
export class WorkflowError extends Error {
  readonly code: WorkflowErrorCode;

  constructor(code: WorkflowErrorCode, message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "WorkflowError";
    this.code = code;
  }
}

/** Throw from `ctx.step` to fail the run immediately instead of retrying. */
export class WorkflowNonRetryableError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = "WorkflowNonRetryableError";
  }
}
