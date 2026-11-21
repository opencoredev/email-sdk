import { ConvexError, v } from "convex/values";

import type { Doc } from "./_generated/dataModel.js";
import { internalMutation, mutation, query } from "./_generated/server.js";
import type { MutationCtx, QueryCtx } from "./_generated/server.js";
import {
  markFailedOrRetryArgs,
  markProcessingArgs,
  markProcessingReturns,
  markSentArgs,
  recordProviderAttemptArgs,
  recordWebhookArgs,
  senderHandle,
  sweepArgs,
  type SenderHandle,
} from "./functionRefs.js";
import type {
  ConvexEmailConfig,
  ConvexEmailProviderFailure,
  ConvexEmailSendArgs,
} from "../shared/types.js";
import {
  vCancelEmailArgs,
  vEmailConfig,
  vEnqueueBatchArgs,
  vEnqueueEmailArgs,
  vEnqueueOwnedArgs,
  vEnqueueOwnedBatchArgs,
  vListEmailEventsArgs,
  vRetryWithSenderArgs,
  vStatusArgs,
  vEmailWebhookResult,
  vStoredEmail,
  vStoredEmailEvent,
} from "../shared/validators.js";

const configKey = "default";

const senderKey = "default";

const processingTimeoutMs = 10 * 60 * 1_000;

const cleanupBatchSize = 50;

const maxBatchSize = 100;

export const enqueue = mutation({
  args: vEnqueueEmailArgs,
  returns: v.string(),
  handler: async (ctx, { sender, ...email }) => {
    return await enqueueEmail(ctx, { email, sender: await registerSender(ctx, sender) });
  },
});

/** Only app-side wrappers should call this; it stamps ownership for public API access. */
export const enqueueOwned = mutation({
  args: vEnqueueOwnedArgs,
  returns: v.string(),
  handler: async (ctx, args) => {
    return await enqueueEmail(ctx, {
      email: args.email,
      sender: await registerSender(ctx, args.sender),
      ownerId: args.ownerId,
    });
  },
});

/** Only app-side wrappers should call this; it atomically stamps ownership for public batch sends. */
export const enqueueOwnedBatch = mutation({
  args: vEnqueueOwnedBatchArgs,
  returns: v.array(v.string()),
  handler: async (ctx, args) => {
    if (args.messages.length > maxBatchSize) {
      throw new ConvexError({
        code: "BATCH_TOO_LARGE",
        message: `sendBatch accepts at most ${maxBatchSize} messages per mutation. Split larger batches client-side.`,
      });
    }

    const config = await readConfig(ctx);
    const sender = await registerSender(ctx, args.sender);
    const ids: string[] = [];

    for (const email of args.messages) {
      ids.push(await enqueueEmail(ctx, { email, sender, config, ownerId: args.ownerId }));
    }

    return ids;
  },
});

export const enqueueBatch = mutation({
  args: vEnqueueBatchArgs,
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
    const sender = await registerSender(ctx, args.sender);
    const ids: string[] = [];

    for (const email of args.messages) {
      ids.push(await enqueueEmail(ctx, { email, sender, config }));
    }

    return ids;
  },
});

export const status = query({
  args: vStatusArgs,
  returns: v.union(vStoredEmail, v.null()),
  handler: async (ctx, args) => {
    const emailId = ctx.db.normalizeId("emails", args.emailId);

    return emailId ? await ctx.db.get(emailId) : null;
  },
});

export const listEvents = query({
  args: vListEmailEventsArgs,
  returns: v.array(vStoredEmailEvent),
  handler: async (ctx, args) => {
    const emailId = ctx.db.normalizeId("emails", args.emailId);

    if (!emailId) {
      return [];
    }

    return await ctx.db
      .query("emailEvents")
      .withIndex("by_emailId_and_createdAt", (q) => q.eq("emailId", emailId))
      .order("asc")
      .collect();
  },
});

export const cancel = mutation({
  args: vCancelEmailArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const emailId = ctx.db.normalizeId("emails", args.emailId);
    const email = emailId ? await ctx.db.get(emailId) : null;

    if (!email || email.status !== "queued") {
      return false;
    }

    const now = Date.now();
    await ctx.db.patch(email._id, {
      status: "canceled",
      updatedAt: now,
      terminalAt: now,
    });
    await insertEvent(ctx, { emailId: email._id, type: "canceled" });

    return true;
  },
});

export const retry = mutation({
  args: vRetryWithSenderArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const emailId = ctx.db.normalizeId("emails", args.emailId);
    const email = emailId ? await ctx.db.get(emailId) : null;

    if (!email || email.status !== "failed") {
      return false;
    }

    // Failures recorded before unknownDeliveryAdapter existed still carry the unknown outcome in
    // providerFailure, which this retry clears, so carry it over to the pin first. That record can
    // hold a provider's factory name rather than the registered one; refuse the retry when it
    // can't be resolved to exactly one registered adapter.
    if (email.providerFailure?.delivery === "unknown" && !email.unknownDeliveryAdapter) {
      const pinned = registeredAdapterName(email, email.providerFailure.adapter);

      if (!pinned) {
        return false;
      }

      await pinUnknownDelivery(ctx, email, pinned);
    }

    const now = Date.now();
    await ctx.db.patch(email._id, {
      status: "queued",
      attemptCount: 0,
      nextAttemptAt: now,
      lastError: undefined,
      providerFailure: undefined,
      providerMessageId: undefined,
      terminalAt: undefined,
      updatedAt: now,
    });
    await insertEvent(ctx, {
      emailId: email._id,
      type: "retry_scheduled",
      payload: {
        manual: true,
        previousAttemptCount: email.attemptCount,
      },
      createdAt: now,
    });
    await ctx.scheduler.runAfter(0, await registerSender(ctx, args.sender), { emailId: email._id });

    return true;
  },
});

export const setConfig = mutation({
  args: { config: vEmailConfig },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await getConfigDoc(ctx);
    const now = Date.now();

    // 2026-07-06: setConfig replaces the stored config document instead of merging into it.
    // Merge semantics made it impossible to clear a field (the validator cannot carry an
    // explicit undefined), so stale defaultFrom/cleanupAfterDays values could never be unset.
    if (existing) {
      await ctx.db.replace(existing._id, { key: configKey, ...args.config, updatedAt: now });
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

// The four mutations below are the app-side sender's lease protocol. They are public inside the
// component so the app's sender action can call them through `components.<name>`; component
// functions are never reachable by browser clients directly.

export const markProcessing = mutation({
  args: markProcessingArgs,
  returns: markProcessingReturns,
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);

    if (!email || email.status !== "queued") {
      return null;
    }

    const now = Date.now();
    const attemptCount = email.attemptCount + 1;
    const processingLease = (email.processingLease ?? 0) + 1;
    await ctx.db.patch(args.emailId, {
      status: "processing",
      attemptCount,
      processingLease,
      dispatchedAdapter: undefined,
      updatedAt: now,
      nextAttemptAt: undefined,
    });
    await insertEvent(ctx, {
      emailId: args.emailId,
      type: "processing",
      attempt: attemptCount,
      adapter: email.adapter,
    });

    return {
      ...email,
      status: "processing" as const,
      attemptCount,
      processingLease,
      dispatchedAdapter: undefined,
    };
  },
});

export const recordProviderAttempt = mutation({
  args: recordProviderAttemptArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);

    if (!email || email.status !== "processing" || email.processingLease !== args.processingLease) {
      return false;
    }

    const now = Date.now();

    const attemptedAdapters = email.attemptedAdapters.includes(args.adapter)
      ? email.attemptedAdapters
      : [...email.attemptedAdapters, args.adapter];

    await ctx.db.patch(args.emailId, {
      attemptedAdapters,
      dispatchedAdapter: args.adapter,
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

    return true;
  },
});

export const markSent = mutation({
  args: markSentArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);

    if (!email || email.status !== "processing" || email.processingLease !== args.processingLease) {
      return false;
    }

    const response = args.response;
    const now = Date.now();

    await ctx.db.patch(args.emailId, {
      status: "sent",
      providerMessageId: response.id,
      updatedAt: now,
      sentAt: now,
      terminalAt: now,
      lastError: undefined,
      providerFailure: undefined,
    });
    await insertEvent(ctx, {
      emailId: args.emailId,
      type: "sent",
      adapter: response.adapter,
      providerMessageId: response.id,
      payload: {
        id: response.id,
        accepted: response.accepted,
        rejected: response.rejected,
      },
    });

    return true;
  },
});

export const markFailedOrRetry = mutation({
  args: markFailedOrRetryArgs,
  returns: v.boolean(),
  handler: async (ctx, args) => {
    const email = await ctx.db.get(args.emailId);

    if (!email || email.status !== "processing" || email.processingLease !== args.processingLease) {
      return false;
    }

    await markEmailFailedOrRetry(ctx, email, args.error, {
      retryable: args.retryable,
      providerFailure: args.providerFailure,
      unknownDeliveryAdapter: args.unknownDeliveryAdapter,
    });

    return true;
  },
});

export const processDueEmails = internalMutation({
  args: sweepArgs,
  returns: v.number(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await cleanupExpiredEmailRecords(ctx, now, cleanupBatchSize);
    const sender = await readSender(ctx);

    // Every enqueue registers the sender first, so no sender means no email was ever queued.
    if (!sender) {
      return 0;
    }

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
      await ctx.scheduler.runAfter(0, sender, { emailId: email._id });
    }

    for (const email of staleProcessing) {
      // The worker stopped mid-send, so the adapter this lease last reached may have sent it.
      await pinUnknownDelivery(ctx, email, email.dispatchedAdapter);

      if (email.idempotencyKey?.trim()) {
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
  args: sweepArgs,
  returns: v.number(),
  handler: async (ctx, args) => {
    return await cleanupExpiredEmailRecords(ctx, Date.now(), args.limit ?? cleanupBatchSize);
  },
});

export const recordWebhook = internalMutation({
  args: recordWebhookArgs,
  returns: vEmailWebhookResult,
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
      event: args.event,
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
      await applyDeliveryStatus(ctx, email, args.event, now);
    }

    return { ok: true };
  },
});

type EnqueueEmailOptions = {
  email: ConvexEmailSendArgs;
  sender: SenderHandle;
  /** The shared config, when the caller already read it for a whole batch. */
  config?: ConvexEmailConfig;
  ownerId?: string;
};

async function enqueueEmail(ctx: MutationCtx, options: EnqueueEmailOptions) {
  const { email: args, sender, ownerId } = options;
  const idempotencyKey = args.idempotencyKey?.trim() ? args.idempotencyKey : undefined;

  if (idempotencyKey) {
    const existing = ownerId
      ? await ctx.db
          .query("emails")
          .withIndex("by_ownerId_and_idempotencyKey", (q) =>
            q.eq("ownerId", ownerId).eq("idempotencyKey", idempotencyKey),
          )
          .first()
      : await ctx.db
          .query("emails")
          .withIndex("by_idempotencyKey", (q) => q.eq("idempotencyKey", idempotencyKey))
          .first();

    if (existing) {
      return existing._id;
    }
  }

  const config = options.config ?? (await readConfig(ctx));
  const now = Date.now();
  const message = applyConfigToMessage(args, config);

  const emailId = await ctx.db.insert("emails", {
    status: "queued",
    message,
    ownerId,
    adapter: args.adapter,
    attemptedAdapters: [],
    fallbackAdapters: args.fallbackAdapters ?? [],
    adapters: args.adapters ?? [],
    providerMessageId: undefined,
    idempotencyKey,
    sendMetadata: args.sendMetadata,
    attemptCount: 0,
    processingLease: 0,
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
  await ctx.scheduler.runAfter(0, sender, { emailId });

  return emailId;
}

async function getSenderDoc(ctx: QueryCtx) {
  return await ctx.db
    .query("sender")
    .withIndex("by_key", (q) => q.eq("key", senderKey))
    .first();
}

/**
 * Records the app's sender handle. Writes only when it changed, so concurrent sends with the same
 * handle only read the row and never conflict on it.
 *
 * One sender per component instance, last writer wins. Storing the handle per email would leave
 * queued and retrying emails pointing at a dead function once the app renames or moves its sender
 * action. Apps that need two senders mount the component twice under different names.
 */
async function registerSender(ctx: MutationCtx, handle: string) {
  const existing = await getSenderDoc(ctx);

  if (existing?.handle !== handle) {
    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, { handle, updatedAt: now });
    } else {
      await ctx.db.insert("sender", { key: senderKey, handle, updatedAt: now });
    }
  }

  return senderHandle(handle);
}

async function readSender(ctx: QueryCtx) {
  const doc = await getSenderDoc(ctx);

  return doc ? senderHandle(doc.handle) : undefined;
}

/** The registered sender. Only call this for an email that exists, which implies one was registered. */
async function requireSender(ctx: QueryCtx) {
  const sender = await readSender(ctx);

  if (!sender) {
    throw new ConvexError({
      code: "MISSING_SENDER",
      message: "Convex Email has no sender action registered. Send through the ConvexEmail client.",
    });
  }

  return sender;
}

async function readConfig(ctx: QueryCtx): Promise<ConvexEmailConfig> {
  const config = await getConfigDoc(ctx);

  return config ?? {};
}

async function getConfigDoc(ctx: QueryCtx) {
  return await ctx.db
    .query("config")
    .withIndex("by_key", (q) => q.eq("key", configKey))
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
    idempotencyKey: args.idempotencyKey?.trim() ? args.idempotencyKey : undefined,
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

/** The one registered adapter a stored adapter name can refer to, by registered or factory name. */
function registeredAdapterName(email: Doc<"emails">, adapter: string) {
  const matches = new Set(
    email.adapters
      .filter((config) => (config.name ?? config.kind) === adapter || config.kind === adapter)
      .map((config) => config.name ?? config.kind),
  );

  return matches.size === 1 ? [...matches][0] : undefined;
}

/**
 * Each queued attempt builds a fresh client that starts again at the primary adapter, so the SDK
 * can't see that an earlier attempt may have sent the message. Remember the first adapter whose
 * outcome was unknown; the worker then sends only to it and never falls back.
 */
async function pinUnknownDelivery(
  ctx: MutationCtx,
  email: Doc<"emails">,
  adapter: string | undefined,
) {
  if (!adapter || email.unknownDeliveryAdapter) {
    return;
  }

  await ctx.db.patch(email._id, { unknownDeliveryAdapter: adapter });
}

async function markEmailFailedOrRetry(
  ctx: MutationCtx,
  email: Doc<"emails">,
  error: string,
  options: {
    immediate?: boolean;
    retryable?: boolean;
    providerFailure?: ConvexEmailProviderFailure;
    unknownDeliveryAdapter?: string;
  } = {},
) {
  if (email.status === "sent" || email.status === "canceled") {
    return;
  }

  const now = Date.now();
  const providerFailure = options.providerFailure;

  await pinUnknownDelivery(ctx, email, options.unknownDeliveryAdapter);

  if ((options.retryable ?? true) && email.attemptCount < email.maxAttempts) {
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
    const payload: RetryScheduledPayload = { delayMs, nextAttemptAt };

    if (providerFailure) {
      payload.providerFailure = providerFailure;
    }

    await insertEvent(ctx, {
      emailId: email._id,
      type: "retry_scheduled",
      attempt: email.attemptCount,
      error,
      payload,
    });

    const sender = await requireSender(ctx);

    if (options.immediate) {
      await ctx.scheduler.runAfter(0, sender, { emailId: email._id });
    } else {
      await ctx.scheduler.runAt(nextAttemptAt, sender, { emailId: email._id });
    }

    return;
  }

  await ctx.db.patch(email._id, {
    status: "failed",
    lastError: error,
    updatedAt: now,
    terminalAt: now,
  });

  if (providerFailure) {
    await ctx.db.patch(email._id, {
      providerFailure,
      providerMessageId: providerFailure.requestId,
    });
  }

  await insertEvent(ctx, {
    emailId: email._id,
    type: "failed",
    adapter: providerFailure?.adapter,
    attempt: email.attemptCount,
    providerMessageId: providerFailure?.requestId,
    error,
    payload: providerFailure ? { providerFailure } : undefined,
  });
}

async function applyDeliveryStatus(
  ctx: MutationCtx,
  email: Doc<"emails">,
  event: string | undefined,
  now: number,
) {
  if (event === "delivered") {
    // 2026-07-06: bounced/complained are sticky against "delivered". Provider webhook retries
    // can arrive out of order, so a late "delivered" event must never overwrite a recorded
    // bounce or complaint.
    if (email.deliveryStatus) {
      return;
    }

    await ctx.db.patch(email._id, {
      deliveryStatus: "delivered",
      deliveredAt: now,
      updatedAt: now,
    });

    return;
  }

  if (event === "bounced" || event === "complained") {
    // Between bounced and complained the most recent event wins (both overwrite "delivered"
    // and each other). Either value means "stop mailing this recipient", so ordering between
    // them is not load-bearing; the full sequence stays in the event history.
    await ctx.db.patch(email._id, {
      deliveryStatus: event,
      updatedAt: now,
    });
  }
}

async function cleanupExpiredEmailRecords(ctx: MutationCtx, now: number, limit: number) {
  const config = await readConfig(ctx);

  if (!config.cleanupAfterDays || config.cleanupAfterDays <= 0) {
    return 0;
  }

  const cutoff = now - config.cleanupAfterDays * 24 * 60 * 60 * 1_000;

  const expiredCandidates = await ctx.db
    .query("emails")
    .withIndex("by_terminalAt", (q) => q.gt("terminalAt", 0).lt("terminalAt", cutoff))
    .take(limit);

  const expired = expiredCandidates.filter(
    (email) =>
      email.terminalAt !== undefined &&
      email.terminalAt < cutoff &&
      (email.status === "sent" || email.status === "failed" || email.status === "canceled"),
  );

  for (const email of expired) {
    const events = await ctx.db
      .query("emailEvents")
      .withIndex("by_emailId_and_createdAt", (q) => q.eq("emailId", email._id))
      .take(1_000);

    const deliveries = await ctx.db
      .query("webhookDeliveries")
      .withIndex("by_emailId", (q) => q.eq("emailId", email._id))
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

type RetryScheduledPayload = {
  delayMs: number;
  nextAttemptAt: number;
  providerFailure?: ConvexEmailProviderFailure;
};

type NewEmailEvent = Omit<Doc<"emailEvents">, "_id" | "_creationTime" | "createdAt"> & {
  createdAt?: number;
};

async function insertEvent(ctx: MutationCtx, event: NewEmailEvent) {
  await ctx.db.insert("emailEvents", {
    ...event,
    createdAt: event.createdAt ?? Date.now(),
  });
}

async function markEmailTerminalFailed(ctx: MutationCtx, email: Doc<"emails">, error: string) {
  if (email.status === "sent" || email.status === "canceled") {
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
