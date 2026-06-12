import type { EmailProviderResponse } from "@opencoredev/email-sdk";
import type { FunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";

import { internal } from "./_generated/api.js";
import type { Id } from "./_generated/dataModel.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import type { ConvexEmailConfig, ConvexEmailSendArgs } from "../shared/types.js";
import {
  vCancelEmailArgs,
  vEmailConfig,
  vListEmailEventsArgs,
  vSendBatchEmailsArgs,
  vSendEmailArgs,
  vStatusArgs,
  vStoredEmail,
  vStoredEmailEvent,
} from "../shared/validators.js";

const configKey = "default";
type ProcessEmailRef = FunctionReference<
  "action",
  "internal",
  { emailId: Id<"emails"> },
  null
>;
const internalApi = internal as unknown as { worker: { processEmail: ProcessEmailRef } };
const processEmailRef = internalApi.worker.processEmail;
const processingTimeoutMs = 10 * 60 * 1_000;
const cleanupBatchSize = 50;
const maxBatchSize = 100;

export const enqueue = mutation({
  args: vSendEmailArgs,
  returns: v.string(),
  handler: async (ctx, args) => {
    return await enqueueEmail(ctx, args);
  },
});

export const enqueueBatch = mutation({
  args: vSendBatchEmailsArgs,
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    if (args.messages.length > maxBatchSize) {
      throw new ConvexError({
        code: "BATCH_TOO_LARGE",
        message: `sendBatch accepts at most ${maxBatchSize} messages per mutation. Split larger batches client-side.`,
      });
    }

    // Read the shared config once for the whole batch instead of once per message.
    const config = await readConfig(ctx);
    const ids: string[] = [];

    for (const message of args.messages) {
      ids.push(await enqueueEmail(ctx, message, config));
    }

    return ids;
  },
});

export const status = query({
  args: vStatusArgs,
  returns: v.union(vStoredEmail, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.emailId as Id<"emails">);
  },
});

export const listEvents = query({
  args: vListEmailEventsArgs,
  returns: v.array(vStoredEmailEvent),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("emailEvents")
      .withIndex("by_emailId_and_createdAt", (q) => q.eq("emailId", args.emailId as Id<"emails">))
      .order("asc")
      .collect();
  },
});

export const cancel = mutation({
  args: vCancelEmailArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const emailId = args.emailId as Id<"emails">;
    const email = await ctx.db.get(emailId);

    if (!email || email.status !== "queued") {
      return false;
    }

    const now = Date.now();
    await ctx.db.patch(emailId, {
      status: "canceled",
      updatedAt: now,
      terminalAt: now,
    });
    await insertEvent(ctx, { emailId, type: "canceled" });

    return true;
  },
});

export const setConfig = mutation({
  args: { config: vEmailConfig },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await getConfigDoc(ctx);
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, { ...args.config, updatedAt: now });
    } else {
      await ctx.db.insert("config", { key: configKey, ...args.config, updatedAt: now });
    }

    return null;
  },
});

export const getConfig = query({
  args: {},
  returns: v.union(vEmailConfig, v.null()),
  handler: async (ctx) => {
    const config = await getConfigDoc(ctx);

    if (!config) {
      return null;
    }

    return {
      testMode: config.testMode,
      sandboxTo: config.sandboxTo,
      defaultFrom: config.defaultFrom,
      maxAttempts: config.maxAttempts,
      retryBaseMs: config.retryBaseMs,
      cleanupAfterDays: config.cleanupAfterDays,
    };
  },
});

export const markProcessing = internalMutation({
  args: { emailId: v.id("emails") },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);

    if (!email || email.status !== "queued") {
      return null;
    }

    const now = Date.now();
    const attemptCount = email.attemptCount + 1;
    await ctx.db.patch(args.emailId, {
      status: "processing",
      attemptCount,
      updatedAt: now,
      nextAttemptAt: undefined,
    });
    await insertEvent(ctx, {
      emailId: args.emailId,
      type: "processing",
      attempt: attemptCount,
      adapter: email.adapter,
    });

    return { ...email, status: "processing", attemptCount };
  },
});

export const recordProviderAttempt = internalMutation({
  args: {
    emailId: v.id("emails"),
    adapter: v.string(),
    attempt: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);

    if (!email) {
      return null;
    }

    const now = Date.now();
    const attemptedAdapters = email.attemptedAdapters.includes(args.adapter)
      ? email.attemptedAdapters
      : [...email.attemptedAdapters, args.adapter];

    await ctx.db.patch(args.emailId, {
      attemptedAdapters,
      updatedAt: now,
    });
    await insertEvent(ctx, {
      emailId: args.emailId,
      type: "provider_attempt",
      adapter: args.adapter,
      attempt: args.attempt,
      payload: {
        componentAttempt: email.attemptCount,
      },
      createdAt: now,
    });

    return null;
  },
});

export const markSent = internalMutation({
  args: {
    emailId: v.id("emails"),
    response: v.any(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const response = args.response as EmailProviderResponse;
    const now = Date.now();

    await ctx.db.patch(args.emailId, {
      status: "sent",
      providerMessageId: response.messageId ?? response.id,
      updatedAt: now,
      sentAt: now,
      terminalAt: now,
      lastError: undefined,
    });
    await insertEvent(ctx, {
      emailId: args.emailId,
      type: "sent",
      adapter: response.provider,
      providerMessageId: response.messageId ?? response.id,
      payload: {
        id: response.id,
        messageId: response.messageId,
        accepted: response.accepted,
        rejected: response.rejected,
      },
    });

    return null;
  },
});

export const markFailedOrRetry = internalMutation({
  args: {
    emailId: v.id("emails"),
    error: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);

    await markEmailFailedOrRetry(ctx, email, args.error);

    return null;
  },
});

export const processDueEmails = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await cleanupExpiredEmailRecords(ctx, now, cleanupBatchSize);

    const due = await ctx.db
      .query("emails")
      .withIndex("by_status_and_nextAttemptAt", (q) =>
        q.eq("status", "queued").lte("nextAttemptAt", now),
      )
      .take(args.limit ?? 25);
    const staleProcessing = await ctx.db
      .query("emails")
      .withIndex("by_status_and_updatedAt", (q) =>
        q.eq("status", "processing").lte("updatedAt", now - processingTimeoutMs),
      )
      .take(args.limit ?? 25);

    for (const email of due) {
      await ctx.scheduler.runAfter(0, processEmailRef, { emailId: email._id });
    }
    for (const email of staleProcessing) {
      if (email.idempotencyKey) {
        await markEmailFailedOrRetry(ctx, email, "Email processing exceeded recovery timeout.", {
          immediate: true,
        });
      } else {
        await markEmailTerminalFailed(
          ctx,
          email,
          "Email processing exceeded recovery timeout. Convex Email will not retry stale processing sends without an idempotencyKey because the provider request may already have been delivered.",
        );
      }
    }

    return due.length + staleProcessing.length;
  },
});

export const cleanupExpiredEmails = internalMutation({
  args: { limit: v.optional(v.number()) },
  returns: v.number(),
  handler: async (ctx, args) => {
    return await cleanupExpiredEmailRecords(ctx, Date.now(), args.limit ?? cleanupBatchSize);
  },
});

export const recordWebhook = internalMutation({
  args: {
    provider: v.string(),
    deliveryId: v.string(),
    providerMessageId: v.optional(v.string()),
    payload: v.any(),
  },
  returns: v.object({ ok: v.boolean(), duplicate: v.optional(v.boolean()) }),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_provider_and_deliveryId", (q) =>
        q.eq("provider", args.provider).eq("deliveryId", args.deliveryId),
      )
      .first();

    if (existing) {
      return { ok: true, duplicate: true };
    }

    const email = args.providerMessageId
      ? await ctx.db
          .query("emails")
          .withIndex("by_providerMessageId", (q) =>
            q.eq("providerMessageId", args.providerMessageId),
          )
          .first()
      : null;
    const now = Date.now();

    await ctx.db.insert("webhookDeliveries", {
      provider: args.provider,
      deliveryId: args.deliveryId,
      emailId: email?._id,
      providerMessageId: args.providerMessageId,
      receivedAt: now,
      processedAt: now,
      status: "processed",
    });

    if (email) {
      await insertEvent(ctx, {
        emailId: email._id,
        type: "webhook",
        adapter: args.provider,
        providerMessageId: args.providerMessageId,
        payload: args.payload,
      });
    }

    return { ok: true };
  },
});

async function enqueueEmail(
  ctx: any,
  args: ConvexEmailSendArgs,
  preloadedConfig?: ConvexEmailConfig,
) {
  const idempotencyKey = args.idempotencyKey;

  if (idempotencyKey) {
    const existing = await ctx.db
      .query("emails")
      .withIndex("by_idempotencyKey", (q: any) => q.eq("idempotencyKey", idempotencyKey))
      .first();

    if (existing) {
      return existing._id as string;
    }
  }

  const config = preloadedConfig ?? (await readConfig(ctx));
  const now = Date.now();
  const message = applyConfigToMessage(args, config);
  const emailId = await ctx.db.insert("emails", {
    status: "queued",
    message,
    adapter: args.adapter,
    attemptedAdapters: [],
    fallbackAdapters: args.fallbackAdapters ?? [],
    adapters: args.adapters ?? [],
    providerMessageId: undefined,
    idempotencyKey,
    sendMetadata: args.sendMetadata,
    attemptCount: 0,
    maxAttempts:
      args.maxAttempts ??
      (args.retries === undefined ? undefined : args.retries + 1) ??
      config.maxAttempts ??
      3,
    retryBaseMs: args.retryBaseMs ?? config.retryBaseMs ?? 1_000,
    nextAttemptAt: now,
    lastError: undefined,
    createdAt: now,
    updatedAt: now,
    sentAt: undefined,
    terminalAt: undefined,
  });

  await insertEvent(ctx, {
    emailId,
    type: "queued",
    payload: redactMessage(message),
  });
  await ctx.scheduler.runAfter(0, processEmailRef, { emailId });

  return emailId as string;
}

async function readConfig(ctx: any): Promise<ConvexEmailConfig> {
  const config = await getConfigDoc(ctx);
  return config ?? {};
}

async function getConfigDoc(ctx: any) {
  return await ctx.db
    .query("config")
    .withIndex("by_key", (q: any) => q.eq("key", configKey))
    .first();
}

function applyConfigToMessage(args: ConvexEmailSendArgs, config: ConvexEmailConfig) {
  const from = args.from ?? config.defaultFrom;

  if (!from) {
    throw new ConvexError({
      code: "MISSING_FROM",
      message: "Provide `from` when sending email or configure `defaultFrom` with setConfig.",
    });
  }

  const message = {
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    cc: args.cc,
    bcc: args.bcc,
    replyTo: args.replyTo,
    headers: args.headers,
    attachments: args.attachments,
    tags: args.tags,
    metadata: args.metadata,
    idempotencyKey: args.idempotencyKey,
  };

  if (!config.testMode) {
    return message;
  }

  if (!config.sandboxTo?.length) {
    throw new ConvexError({
      code: "MISSING_SANDBOX_TO",
      message:
        "testMode is enabled but sandboxTo is not configured. Set sandboxTo via setConfig or disable testMode.",
    });
  }

  return {
    ...message,
    to: config.sandboxTo,
    cc: undefined,
    bcc: undefined,
    metadata: {
      ...message.metadata,
      convexEmailTestMode: true,
    },
  };
}

async function markEmailFailedOrRetry(
  ctx: any,
  email: any,
  error: string,
  options: { immediate?: boolean } = {},
) {
  if (!email || email.status === "sent" || email.status === "canceled") {
    return;
  }

  const now = Date.now();

  if (email.attemptCount < email.maxAttempts) {
    const delayMs = options.immediate
      ? 0
      : Math.min(email.retryBaseMs * 2 ** Math.max(email.attemptCount - 1, 0), 60_000);
    const nextAttemptAt = now + delayMs;

    await ctx.db.patch(email._id, {
      status: "queued",
      nextAttemptAt,
      lastError: error,
      updatedAt: now,
    });
    await insertEvent(ctx, {
      emailId: email._id,
      type: "retry_scheduled",
      attempt: email.attemptCount,
      error,
      payload: { delayMs, nextAttemptAt },
    });

    if (options.immediate) {
      await ctx.scheduler.runAfter(0, processEmailRef, { emailId: email._id });
    } else {
      await ctx.scheduler.runAt(nextAttemptAt, processEmailRef, { emailId: email._id });
    }

    return;
  }

  await ctx.db.patch(email._id, {
    status: "failed",
    lastError: error,
    updatedAt: now,
    terminalAt: now,
  });
  await insertEvent(ctx, {
    emailId: email._id,
    type: "failed",
    attempt: email.attemptCount,
    error,
  });
}

async function cleanupExpiredEmailRecords(ctx: any, now: number, limit: number) {
  const config = await readConfig(ctx);

  if (!config.cleanupAfterDays || config.cleanupAfterDays <= 0) {
    return 0;
  }

  const cutoff = now - config.cleanupAfterDays * 24 * 60 * 60 * 1_000;
  const expiredCandidates = await ctx.db
    .query("emails")
    .withIndex("by_terminalAt", (q: any) => q.gt("terminalAt", 0).lt("terminalAt", cutoff))
    .take(limit);
  const expired = expiredCandidates.filter(
    (email: any) =>
      typeof email.terminalAt === "number" &&
      email.terminalAt < cutoff &&
      (email.status === "sent" || email.status === "failed" || email.status === "canceled"),
  );

  for (const email of expired) {
    const events = await ctx.db
      .query("emailEvents")
      .withIndex("by_emailId_and_createdAt", (q: any) => q.eq("emailId", email._id))
      .take(1_000);
    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_emailId", (q: any) => q.eq("emailId", email._id))
      .take(1_000);

    for (const event of events) {
      await ctx.db.delete(event._id);
    }
    for (const delivery of deliveries) {
      await ctx.db.delete(delivery._id);
    }
    await ctx.db.delete(email._id);
  }

  return expired.length;
}

async function insertEvent(
  ctx: any,
  event: {
    emailId: Id<"emails">;
    type:
      | "queued"
      | "processing"
      | "provider_attempt"
      | "sent"
      | "retry_scheduled"
      | "failed"
      | "canceled"
      | "webhook";
    adapter?: string;
    attempt?: number;
    providerMessageId?: string;
    payload?: unknown;
    error?: string;
    createdAt?: number;
  },
) {
  await ctx.db.insert("emailEvents", {
    ...event,
    createdAt: event.createdAt ?? Date.now(),
  });
}

async function markEmailTerminalFailed(ctx: any, email: any, error: string) {
  if (!email || email.status === "sent" || email.status === "canceled") {
    return;
  }

  const now = Date.now();
  await ctx.db.patch(email._id, {
    status: "failed",
    lastError: error,
    updatedAt: now,
    terminalAt: now,
  });
  await insertEvent(ctx, {
    emailId: email._id,
    type: "failed",
    attempt: email.attemptCount,
    error,
  });
}

function redactMessage(message: ConvexEmailSendArgs) {
  return {
    subject: message.subject,
    toCount: countAddresses(message.to),
    ccCount: countAddresses(message.cc),
    bccCount: countAddresses(message.bcc),
    hasHtml: Boolean(message.html),
    hasText: Boolean(message.text),
    attachmentCount: message.attachments?.length ?? 0,
    tagNames: message.tags?.map((tag: { name: string }) => tag.name) ?? [],
    metadataKeys: Object.keys(message.metadata ?? {}),
  };
}

function countAddresses(value: ConvexEmailSendArgs["to"] | undefined) {
  if (!value) {
    return 0;
  }

  return Array.isArray(value) ? value.length : 1;
}
