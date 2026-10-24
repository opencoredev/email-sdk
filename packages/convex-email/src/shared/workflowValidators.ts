import { v } from "convex/values";

/** One workflow run as the component stores it. The app-side store parses `state`. */
export const vWorkflowRunRecord = v.object({
  runId: v.string(),
  workflow: v.string(),
  status: v.string(),
  subject: v.optional(v.string()),
  active: v.boolean(),
  dueAt: v.optional(v.number()),
  revision: v.number(),
  state: v.string(),
});

export const vCreateWorkflowRunArgs = { run: vWorkflowRunRecord };

export const vSaveWorkflowRunArgs = { run: vWorkflowRunRecord, expectedRevision: v.number() };

export const vGetWorkflowRunArgs = { runId: v.string() };

export const vListActiveWorkflowRunsArgs = { subject: v.string() };

export const vListDueWorkflowRunsArgs = { now: v.number(), limit: v.number() };

export const vMaybeWorkflowRunRecord = v.union(vWorkflowRunRecord, v.null());

export const vWorkflowRunRecords = v.array(vWorkflowRunRecord);

export const vWorkflowRunIds = v.array(v.string());
