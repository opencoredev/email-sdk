import type { WorkflowStepRecord } from "./types.js";

/**
 * Where an entry from a journal saved before `sequence` existed falls in run order: its completion
 * time, or last for a retrying entry, since steps run one at a time and a retrying step is the one
 * the run is on.
 */
function legacyPosition(record: WorkflowStepRecord) {
  return record.status === "completed" ? record.completedAt : Number.POSITIVE_INFINITY;
}

/** Sorts unnumbered journal entries into run order. Ties keep their existing order. */
export function compareLegacyRunOrder(a: WorkflowStepRecord, b: WorkflowStepRecord) {
  const difference = legacyPosition(a) - legacyPosition(b);

  return Number.isNaN(difference) ? 0 : difference;
}
