/**
 * Experimental durable email workflows: drips, onboarding sequences, waits, events, and
 * cancellation. Nothing here is imported by the package root.
 */
export { defineWorkflow } from "./workflows/define.js";

export type { DefineWorkflowOptions } from "./workflows/define.js";

export { durationToMs } from "./workflows/duration.js";

export { createWorkflowEngine } from "./workflows/engine.js";

export { WorkflowError, WorkflowNonRetryableError } from "./workflows/errors.js";

export { workflowIdempotencyKey } from "./workflows/idempotency.js";

export type { WorkflowErrorCode } from "./workflows/errors.js";

export {
  createManualClock,
  createMemoryWorkflowScheduler,
  createMemoryWorkflowStore,
  isTerminalRun,
} from "./workflows/memory.js";

export type { ManualClock, MemoryWorkflowScheduler, MemoryWorkflowStore } from "./workflows/memory.js";

export type {
  AnyWorkflowDefinition,
  WorkflowClock,
  WorkflowContext,
  WorkflowDefinition,
  WorkflowDuePage,
  WorkflowDuration,
  WorkflowEmailSender,
  WorkflowEngine,
  WorkflowEngineOptions,
  WorkflowEventInput,
  WorkflowEventResult,
  WorkflowHooks,
  WorkflowInboxEvent,
  WorkflowInputSchema,
  WorkflowJsonValue,
  WorkflowLease,
  WorkflowResumeDueOptions,
  WorkflowRetryPolicy,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowScheduler,
  WorkflowSendOptions,
  WorkflowSendRecord,
  WorkflowStartOptions,
  WorkflowStepKind,
  WorkflowStepOptions,
  WorkflowStepRecord,
  WorkflowStore,
  WorkflowTimer,
  WorkflowWait,
  WorkflowWaitForEventOptions,
} from "./workflows/types.js";
