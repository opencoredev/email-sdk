import { paginationOptsValidator } from "convex/server";
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

export const vListActiveWorkflowRunsArgs = { subject: v.string(), paginationOpts: paginationOptsValidator };

export const vListDueWorkflowRunsArgs = { now: v.number(), paginationOpts: paginationOptsValidator };

export const vMaybeWorkflowRunRecord = v.union(vWorkflowRunRecord, v.null());

export const vWorkflowRunRecords = v.array(vWorkflowRunRecord);

/** One page of active runs for a subject; callers follow `continueCursor` until `isDone`. */
export const vWorkflowRunPage = v.object({
  page: vWorkflowRunRecords,
  isDone: v.boolean(),
  continueCursor: v.string(),
});

/** One page of due run ids, oldest due first; callers follow `continueCursor` until `isDone`. */
export const vWorkflowRunIdPage = v.object({
  page: v.array(v.string()),
  isDone: v.boolean(),
  continueCursor: v.string(),
});
