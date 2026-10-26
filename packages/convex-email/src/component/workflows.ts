import type { Infer } from "convex/values";
import { v } from "convex/values";

import type { Doc } from "./_generated/dataModel.js";
import { mutation, query } from "./_generated/server.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import { enqueueEmail, readConfig } from "./lib.js";
import {
  vCreateWorkflowRunArgs,
  vEnqueueWorkflowSendArgs,
  vGetWorkflowRunArgs,
  vListActiveWorkflowRunsArgs,
  vListDueWorkflowRunsArgs,
  vMaybeWorkflowRunRecord,
  vSaveWorkflowRunArgs,
  vWorkflowRunIdPage,
  vWorkflowRunPage,
} from "../shared/workflowValidators.js";
import type { vWorkflowRunRecord } from "../shared/workflowValidators.js";

const maxDueLimit = 100;

const dayMs = 86_400_000;

const defaultSendRetentionDays = 30;

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

    const now = Date.now();

    await ctx.db.replace(doc._id, { ...args.run, updatedAt: now });

    if (doc.active && !args.run.active) await releaseSends(ctx, args.run.runId, now);

    return true;
  },
});

/**
 * One page of a subject's active runs. A subject can have more runs than one query should read,
 * so the app-side store follows `continueCursor` across queries until `isDone`.
 */
export const listActiveRunsBySubject = query({
  args: vListActiveWorkflowRunsArgs,
  returns: vWorkflowRunPage,
  handler: async (ctx, args) => {
    const result = await ctx.db
      .query("workflowRuns")
      .withIndex("by_subject_and_active", (q) => q.eq("subject", args.subject).eq("active", true))
      .paginate({ ...args.paginationOpts, numItems: Math.min(Math.max(args.paginationOpts.numItems, 1), maxDueLimit) });

    return { page: result.page.map(toRecord), isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/**
 * One page of due run ids, oldest due first. The engine follows `continueCursor` past runs it can't
 * resume, so they never hide later due runs. A page size below 1 returns an empty page.
 */
export const listDueRuns = query({
  args: vListDueWorkflowRunsArgs,
  returns: vWorkflowRunIdPage,
  handler: async (ctx, args) => {
    if (args.paginationOpts.numItems < 1) {
      return { page: [], isDone: true, continueCursor: args.paginationOpts.cursor ?? "" };
    }

    const result = await ctx.db
      .query("workflowRuns")
      .withIndex("by_active_and_dueAt", (q) => q.eq("active", true).gte("dueAt", 0).lte("dueAt", args.now))
      .paginate({ ...args.paginationOpts, numItems: Math.min(args.paginationOpts.numItems, maxDueLimit) });

    return { page: result.page.map((doc) => doc.runId), isDone: result.isDone, continueCursor: result.continueCursor };
  },
});

/**
 * Queues a workflow step's email once. The send record shares this transaction with the enqueue, so
 * a replayed step gets the email it already queued, even after email cleanup deleted that email.
 */
export const enqueueSend = mutation({
  args: vEnqueueWorkflowSendArgs,
  returns: v.string(),
  handler: async (ctx, args) => {
    const idempotencyKey = args.email.idempotencyKey;

    const recorded = await ctx.db
      .query("workflowSends")
      .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
      .unique();

    if (recorded) return recorded.emailId;

    const emailId = await enqueueEmail(ctx, args.email);

    await ctx.db.insert("workflowSends", { idempotencyKey, runId: args.runId, emailId, createdAt: Date.now() });

    return emailId;
  },
});

/** Starts the retention clock on a finished run's send records. A finished run sends nothing more. */
async function releaseSends(ctx: MutationCtx, runId: string, now: number) {
  for await (const send of ctx.db.query("workflowSends").withIndex("by_runId", (q) => q.eq("runId", runId))) {
    if (send.releasedAt === undefined) await ctx.db.patch(send._id, { releasedAt: now });
  }
}

/** Deletes up to `limit` send records released more than `workflowSendRetentionDays` ago. */
export async function cleanupReleasedWorkflowSends(ctx: MutationCtx, now: number, limit: number) {
  const config = await readConfig(ctx);
  const cutoff = now - (config.workflowSendRetentionDays ?? defaultSendRetentionDays) * dayMs;

  const expired = await ctx.db
    .query("workflowSends")
    .withIndex("by_releasedAt", (q) => q.gt("releasedAt", 0).lt("releasedAt", cutoff))
    .take(limit);

  for (const send of expired) await ctx.db.delete(send._id);

  return expired.length;
}
