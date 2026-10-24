/**
 * Experimental: a Convex-backed store, scheduler, and email sender for
 * `@opencoredev/email-sdk/workflows` (requires @opencoredev/email-sdk 3.1 or later).
 *
 * Run the workflow engine inside a Convex action. Runs live in the component's `workflowRuns`
 * table, waits use `ctx.scheduler.runAt`, and each `ctx.send` enqueues through the component's
 * durable queue with the step's idempotency key, so a step is queued at most once.
 */
import type { EmailAddress, EmailAttachment, EmailMessage, OneOrMany } from "@opencoredev/email-sdk";
import { WorkflowNonRetryableError } from "@opencoredev/email-sdk/workflows";
import type {
  WorkflowEmailSender,
  WorkflowRun,
  WorkflowScheduler,
  WorkflowStore,
} from "@opencoredev/email-sdk/workflows";
import type {
  FunctionReference,
  FunctionVisibility,
  GenericActionCtx,
  GenericDataModel,
} from "convex/server";
import type { Infer } from "convex/values";
import { z } from "zod";

import type { ConvexEmailComponentApi } from "../shared/componentApi.js";
import type { ConvexEmailAttachment, ConvexEmailSendArgs } from "../shared/types.js";
import type { vWorkflowRunRecord } from "../shared/workflowValidators.js";

type WorkflowActionCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery" | "runMutation">;

type WorkflowSchedulerCtx = Pick<GenericActionCtx<GenericDataModel>, "scheduler">;

type WorkflowRunRecord = Infer<typeof vWorkflowRunRecord>;

/** The app function a timer calls; it should build the engine and call `engine.resume(runId)`. */
export type ConvexWorkflowResumeRef = FunctionReference<
  "action" | "mutation",
  FunctionVisibility,
  { runId: string }
>;

/** Anything that can enqueue through the component, such as a `ConvexEmail` instance. */
export type ConvexWorkflowEmailQueue = {
  send(ctx: Pick<GenericActionCtx<GenericDataModel>, "runMutation">, args: ConvexEmailSendArgs): Promise<string>;
};

const jsonValue = z.json();

const stepKind = z.enum(["send", "step", "sleep", "event"]);

const runSchema = z.object({
  id: z.string(),
  workflow: z.string(),
  version: z.number(),
  status: z.enum(["running", "waiting", "completed", "failed", "canceled"]),
  input: jsonValue,
  subject: z.string().optional(),
  journal: z.record(
    z.string(),
    z.discriminatedUnion("status", [
      z.object({
        status: z.literal("completed"),
        kind: stepKind,
        result: jsonValue.optional(),
        completedAt: z.number(),
      }),
      z.object({
        status: z.literal("retrying"),
        kind: z.enum(["send", "step"]),
        attempts: z.number(),
        lastError: z.string(),
      }),
    ]),
  ),
  inbox: z.array(z.object({ name: z.string(), payload: jsonValue.optional(), receivedAt: z.number() })),
  wait: z
    .discriminatedUnion("kind", [
      z.object({ kind: z.literal("sleep"), step: z.string(), until: z.number() }),
      z.object({ kind: z.literal("retry"), step: z.string(), until: z.number() }),
      z.object({ kind: z.literal("event"), step: z.string(), event: z.string(), until: z.number().optional() }),
    ])
    .optional(),
  output: jsonValue.optional(),
  error: z.object({ message: z.string(), step: z.string().optional() }).optional(),
  cancelReason: z.string().optional(),
  lease: z.object({ owner: z.string(), until: z.number() }).optional(),
  revision: z.number(),
  dueAt: z.number().optional(),
  createdAt: z.number(),
  updatedAt: z.number(),
});

const stringContent = z.string();

const subjectPageSize = 100;

const terminalStatuses = new Set(["completed", "failed", "canceled"]);

/** Parses a stored run at the component boundary. */
export function parseWorkflowRun(state: string): WorkflowRun {
  return runSchema.parse(JSON.parse(state));
}

function toRecord(run: WorkflowRun): WorkflowRunRecord {
  const record: WorkflowRunRecord = {
    runId: run.id,
    workflow: run.workflow,
    status: run.status,
    active: !terminalStatuses.has(run.status),
    revision: run.revision,
    state: JSON.stringify(run),
  };

  if (run.subject !== undefined) record.subject = run.subject;

  if (run.dueAt !== undefined) record.dueAt = run.dueAt;

  return record;
}

/** A `WorkflowStore` over the component's `workflowRuns` table. Saves are revision-checked in one transaction. */
export function convexWorkflowStore(component: ConvexEmailComponentApi, ctx: WorkflowActionCtx): WorkflowStore {
  const api = component.workflows;

  return {
    async get(id) {
      const record = await ctx.runQuery(api.getRun, { runId: id });

      return record ? parseWorkflowRun(record.state) : undefined;
    },
    async create(run) {
      return await ctx.runMutation(api.createRun, { run: toRecord(run) });
    },
    async save(run, expectedRevision) {
      return await ctx.runMutation(api.saveRun, { run: toRecord(run), expectedRevision });
    },
    async listActiveBySubject(subject) {
      const runs: WorkflowRun[] = [];
      let cursor: string | null = null;

      // Each page is its own query, so a subject with many runs stays inside Convex read limits.
      for (;;) {
        const result: { page: WorkflowRunRecord[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(
          api.listActiveRunsBySubject,
          { subject, paginationOpts: { numItems: subjectPageSize, cursor } },
        );

        for (const record of result.page) runs.push(parseWorkflowRun(record.state));

        if (result.isDone) return runs;
        cursor = result.continueCursor;
      }
    },
    async listDue(now, limit) {
      return await ctx.runQuery(api.listDueRuns, { now, limit });
    },
  };
}

/**
 * A `WorkflowScheduler` on `ctx.scheduler.runAt`. `cancel` is a no-op: `engine.resume` ignores
 * timers for runs that are canceled, finished, or not yet due.
 */
export function convexWorkflowScheduler(ctx: WorkflowSchedulerCtx, resume: ConvexWorkflowResumeRef): WorkflowScheduler {
  return {
    async schedule(timer) {
      await ctx.scheduler.runAt(timer.at, resume, { runId: timer.runId });
    },
    cancel() {},
  };
}

function addresses(value: OneOrMany<EmailAddress> | undefined): EmailAddress | EmailAddress[] | undefined {
  if (value === undefined) return undefined;

  return isAddressList(value) ? [...value] : value;
}

function isAddressList(value: OneOrMany<EmailAddress>): value is readonly EmailAddress[] {
  return Array.isArray(value);
}

function toConvexAttachment(attachment: EmailAttachment): ConvexEmailAttachment {
  const content = stringContent.safeParse(attachment.content);

  if (!content.success) {
    throw new WorkflowNonRetryableError(
      `Attachment "${attachment.filename}" must have string content to be queued through Convex. Use contentEncoding: "base64" for binary data.`,
    );
  }

  const converted: ConvexEmailAttachment = { filename: attachment.filename, content: content.data };

  if (attachment.contentEncoding !== undefined) converted.contentEncoding = attachment.contentEncoding;

  if (attachment.contentType !== undefined) converted.contentType = attachment.contentType;

  if (attachment.contentId !== undefined) converted.contentId = attachment.contentId;

  if (attachment.disposition !== undefined) converted.disposition = attachment.disposition;

  return converted;
}

/** Maps an Email SDK message onto the component's enqueue arguments. */
export function toConvexSendArgs(message: EmailMessage, idempotencyKey: string | undefined): ConvexEmailSendArgs {
  if (message.sendAt !== undefined) {
    throw new WorkflowNonRetryableError("Workflow sends through Convex do not support sendAt; use ctx.sleepUntil before the send.");
  }

  const args: ConvexEmailSendArgs = {
    from: message.from,
    to: addresses(message.to) ?? [],
    subject: message.subject,
  };

  if (message.html !== undefined) args.html = message.html;

  if (message.text !== undefined) args.text = message.text;

  const cc = addresses(message.cc);
  const bcc = addresses(message.bcc);
  const replyTo = addresses(message.replyTo);

  if (cc !== undefined) args.cc = cc;

  if (bcc !== undefined) args.bcc = bcc;

  if (replyTo !== undefined) args.replyTo = replyTo;

  if (message.headers !== undefined) args.headers = [...message.headers];

  if (message.tags !== undefined) args.tags = [...message.tags];

  if (message.metadata !== undefined) args.metadata = { ...message.metadata };

  if (message.attachments !== undefined) args.attachments = message.attachments.map(toConvexAttachment);

  if (idempotencyKey !== undefined) args.idempotencyKey = idempotencyKey;

  return args;
}

/**
 * A `WorkflowEmailSender` that enqueues through the component. The step's idempotency key makes a
 * replayed step return the already-queued email instead of queueing a second one. The result id
 * is the component email id; delivery happens asynchronously in the component's worker.
 */
export function convexWorkflowEmail(
  queue: ConvexWorkflowEmailQueue,
  ctx: Pick<GenericActionCtx<GenericDataModel>, "runMutation">,
): WorkflowEmailSender {
  return {
    async send(message, options) {
      const emailId = await queue.send(ctx, toConvexSendArgs(message, options?.idempotencyKey));

      return { adapter: "convex-email", id: emailId };
    },
  };
}
