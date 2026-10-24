import type { Infer } from "convex/values";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel.js";
import { mutation, query } from "./_generated/server.js";
import type { QueryCtx } from "./_generated/server.js";
import {
  vCreateWorkflowRunArgs,
  vGetWorkflowRunArgs,
  vListActiveWorkflowRunsArgs,
  vListDueWorkflowRunsArgs,
  vMaybeWorkflowRunRecord,
  vSaveWorkflowRunArgs,
  vWorkflowRunIds,
  vWorkflowRunRecords,
} from "../shared/workflowValidators.js";
import type { vWorkflowRunRecord } from "../shared/workflowValidators.js";

const maxDueLimit = 100;

type WorkflowRunRecord = Infer<typeof vWorkflowRunRecord>;

function toRecord(doc: Doc<"workflowRuns">): WorkflowRunRecord {
  const record: WorkflowRunRecord = {
    runId: doc.runId,
    workflow: doc.workflow,
    status: doc.status,
    active: doc.active,
    revision: doc.revision,
    state: doc.state,
  };

  if (doc.subject !== undefined) record.subject = doc.subject;

  if (doc.dueAt !== undefined) record.dueAt = doc.dueAt;

  return record;
}

async function findRun(ctx: QueryCtx, runId: string) {
  return await ctx.db
    .query("workflowRuns")
    .withIndex("by_runId", (q) => q.eq("runId", runId))
    .unique();
}

/** Inserts a run. Returns false, without writing, when the run id already exists. */
export const createRun = mutation({
  args: vCreateWorkflowRunArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (await findRun(ctx, args.run.runId)) return false;

    await ctx.db.insert("workflowRuns", { ...args.run, updatedAt: Date.now() });

    return true;
  },
});

export const getRun = query({
  args: vGetWorkflowRunArgs,
  returns: vMaybeWorkflowRunRecord,
  handler: async (ctx, args) => {
    const doc = await findRun(ctx, args.runId);

    return doc ? toRecord(doc) : null;
  },
});

/** Replaces a run when its stored revision equals `expectedRevision`; the check and write share one transaction. */
export const saveRun = mutation({
  args: vSaveWorkflowRunArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const doc = await findRun(ctx, args.run.runId);

    if (!doc || doc.revision !== args.expectedRevision) return false;

    await ctx.db.replace(doc._id, { ...args.run, updatedAt: Date.now() });

    return true;
  },
});

export const listActiveRunsBySubject = query({
  args: vListActiveWorkflowRunsArgs,
  returns: vWorkflowRunRecords,
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("workflowRuns")
      .withIndex("by_subject_and_active", (q) => q.eq("subject", args.subject).eq("active", true))
      .take(maxDueLimit);

    return docs.map(toRecord);
  },
});

export const listDueRuns = query({
  args: vListDueWorkflowRunsArgs,
  returns: vWorkflowRunIds,
  handler: async (ctx, args) => {
    const docs = await ctx.db
      .query("workflowRuns")
      .withIndex("by_active_and_dueAt", (q) => q.eq("active", true).gte("dueAt", 0).lte("dueAt", args.now))
      .take(Math.min(Math.max(args.limit, 1), maxDueLimit));

    return docs.map((doc) => doc.runId);
  },
});
