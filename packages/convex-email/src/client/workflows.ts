/**
 * Experimental: a Convex-backed store, scheduler, and email sender for
 * `@opencoredev/email-sdk/workflows`. Building an engine needs `createWorkflowEngine` from
 * @opencoredev/email-sdk 3.1 or later.
 *
 * Run the workflow engine inside a Convex action. Runs live in the component's `workflowRuns`
 * table, waits use `ctx.scheduler.runAt`, and each `ctx.send` enqueues through the component's
 * durable queue with the step's idempotency key, so a step is queued at most once.
 */
// Only types come from `@opencoredev/email-sdk/workflows`, so the package's runtime code loads with
// email-sdk 3.0.x as well; only apps that build an engine need 3.1. A test enforces this.
import type { EmailAddress, EmailAttachment, EmailMessage, EmailSendOptions, OneOrMany } from "@opencoredev/email-sdk";
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
import type { ConvexEmailAttachment, ConvexEmailSendArgs, ConvexWorkflowSendArgs } from "../shared/types.js";
import type { vWorkflowRunRecord } from "../shared/workflowValidators.js";

type WorkflowActionCtx = Pick<GenericActionCtx<GenericDataModel>, "runQuery" | "runMutation">;

type WorkflowSchedulerCtx = Pick<GenericActionCtx<GenericDataModel>, "scheduler">;

type WorkflowRunRecord = Infer<typeof vWorkflowRunRecord>;

/**
 * The app function a timer calls; it should build the engine and call
 * `engine.resume(runId, { owner })`. `owner` is set on lease-expiry wakes.
 */
export type ConvexWorkflowResumeRef = FunctionReference<
  "action" | "mutation",
  FunctionVisibility,
  { runId: string; owner?: string }
>;

/** Anything that can queue a workflow step's email through the component, such as a `ConvexEmail` instance. */
export type ConvexWorkflowEmailQueue = {
  sendWorkflowStep(ctx: Pick<GenericActionCtx<GenericDataModel>, "runMutation">, args: ConvexWorkflowSendArgs): Promise<string>;
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
        sequence: z.number().optional(),
      }),
      z.object({
        status: z.literal("retrying"),
        kind: z.enum(["send", "step"]),
        attempts: z.number(),
        lastError: z.string(),
        sequence: z.number().optional(),
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

/**
 * Fails the step without a retry. The engine recognizes a non-retryable error by its name, the
 * same way it recognizes one from another bundle, so this needs no runtime import from email-sdk.
 */
class WorkflowNonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WorkflowNonRetryableError";
  }
}

const stringContent = z.string();

/** The flat values the component's queue stores as send metadata. */
const sendMetadataSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean(), z.null()]));

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
    async listDue(now, limit, cursor) {
      const result = await ctx.runQuery(api.listDueRuns, {
        now,
        paginationOpts: { numItems: limit, cursor: cursor ?? null },
      });

      return result.isDone ? { ids: result.page } : { ids: result.page, cursor: result.continueCursor };
    },
  };
}

/**
 * A `WorkflowScheduler` on `ctx.scheduler.runAt`. Each wake is its own job, so a late, stale wake
 * never replaces a newer one, and `timer.revision` is not needed. `cancel` is a no-op:
 * `engine.resume` ignores wakes for runs that are waiting, canceled, or finished. Each claim adds one
 * job for its lease expiry, carrying the claim's `owner`. Only the job of the claim still holding
 * the run adds one more for each lease period the execution keeps renewing; a job left by an
 * earlier claim ends when it fires.
 */
export function convexWorkflowScheduler(ctx: WorkflowSchedulerCtx, resume: ConvexWorkflowResumeRef): WorkflowScheduler {
  return {
    async schedule(timer) {
      const args = timer.owner === undefined ? { runId: timer.runId } : { runId: timer.runId, owner: timer.owner };

      await ctx.scheduler.runAt(timer.at, resume, args);
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

/**
 * Maps per-send options onto the enqueue arguments. The queue stores routing, an attempt count,
 * and flat metadata; options it cannot honor throw instead of being dropped.
 */
function applySendOptions(args: ConvexEmailSendArgs, options: EmailSendOptions) {
  if (options.signal !== undefined) {
    throw new WorkflowNonRetryableError("Workflow sends through Convex do not support signal: the email is queued, not sent in this call.");
  }

  if (options.retry?.delay !== undefined || options.retry?.shouldRetry !== undefined) {
    throw new WorkflowNonRetryableError(
      "Workflow sends through Convex support only retry.maxAttempts; the queue can't store retry.delay or retry.shouldRetry.",
    );
  }

  if (options.fallback?.onUnknownDelivery === "continue") {
    throw new WorkflowNonRetryableError(
      'Workflow sends through Convex always stop on an unknown delivery; fallback.onUnknownDelivery: "continue" is not supported.',
    );
  }

  if (options.adapter !== undefined) args.adapter = options.adapter;

  if (options.fallback !== undefined) args.fallbackAdapters = [...options.fallback.adapters];

  if (options.retry?.maxAttempts !== undefined) args.maxAttempts = options.retry.maxAttempts;

  if (options.metadata !== undefined) {
    const defined = Object.entries(options.metadata).filter(([, value]) => value !== undefined);
    const metadata = sendMetadataSchema.safeParse(Object.fromEntries(defined));

    if (!metadata.success) {
      throw new WorkflowNonRetryableError(
        "Workflow sends through Convex need flat metadata: string, number, boolean, or null values.",
      );
    }

    args.sendMetadata = metadata.data;
  }

  if (options.idempotencyKey !== undefined) args.idempotencyKey = options.idempotencyKey;
}

/** Maps an Email SDK message and its send options onto the component's enqueue arguments. */
export function toConvexSendArgs(message: EmailMessage, options: EmailSendOptions = {}): ConvexEmailSendArgs {
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

  applySendOptions(args, options);

  return args;
}

/**
 * A `WorkflowEmailSender` that enqueues through the component. The component records each send by
 * the step's idempotency key in the same transaction, so a replayed step returns the email it
 * already queued instead of queueing a second one, even after email cleanup deleted that email.
 * The result id is the component email id; delivery happens asynchronously in the component's worker.
 * `ctx.send` options `adapter`, `fallback.adapters`, `retry.maxAttempts`, and flat `metadata`
 * reach the queue; `signal`, `retry.delay`, `retry.shouldRetry`, and
 * `fallback.onUnknownDelivery: "continue"` fail the step because the queue can't honor them.
 */
export function convexWorkflowEmail(
  queue: ConvexWorkflowEmailQueue,
  ctx: Pick<GenericActionCtx<GenericDataModel>, "runMutation">,
): WorkflowEmailSender {
  return {
    async send(message, options, context) {
      const args = toConvexSendArgs(message, options);
      const idempotencyKey = args.idempotencyKey;

      if (context === undefined || idempotencyKey === undefined) {
        throw new WorkflowNonRetryableError(
          "convexWorkflowEmail sends only workflow steps: it needs the engine's run context and idempotency key.",
        );
      }

      const emailId = await queue.sendWorkflowStep(ctx, { runId: context.runId, email: { ...args, idempotencyKey } });

      return { adapter: "convex-email", id: emailId };
    },
  };
}
