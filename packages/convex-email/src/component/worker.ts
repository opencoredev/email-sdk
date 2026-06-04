"use node";

import type { EmailMessage } from "@opencoredev/email-sdk";
import type { FunctionReference } from "convex/server";
import { v } from "convex/values";
import { createHash } from "node:crypto";

import { internal } from "./_generated/api.js";
import { internalAction } from "./_generated/server.js";
import { buildEmailClient, hydrateAttachments } from "./providers.js";
import type { ConvexEmailAdapterConfig } from "../shared/types.js";

type InternalMutationRef = FunctionReference<
  "mutation",
  "internal",
  Record<string, unknown>,
  unknown
>;
type QueuedEmail = {
  adapters: ConvexEmailAdapterConfig[];
  adapter?: string;
  fallbackAdapters: string[];
  message: EmailMessage;
  idempotencyKey?: string;
  sendMetadata?: Record<string, unknown>;
};

const markProcessingRef = (internal as any).lib.markProcessing as InternalMutationRef;
const recordProviderAttemptRef = (internal as any).lib.recordProviderAttempt as InternalMutationRef;
const markSentRef = (internal as any).lib.markSent as InternalMutationRef;
const markFailedOrRetryRef = (internal as any).lib.markFailedOrRetry as InternalMutationRef;
const recordWebhookRef = (internal as any).lib.recordWebhook as InternalMutationRef;

export const processEmail = internalAction({
  args: { emailId: v.id("emails") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = (await ctx.runMutation(markProcessingRef, {
      emailId: args.emailId,
    })) as QueuedEmail | null;

    if (!email) {
      return null;
    }

    try {
      if (email.adapters.length === 0) {
        throw new Error("Convex Email requires at least one adapter configuration.");
      }

      const client = buildEmailClient({
        adapters: email.adapters as ConvexEmailAdapterConfig[],
        defaultAdapter: email.adapter,
        fallbackAdapters: email.fallbackAdapters,
        async recordAttempt(event) {
          await ctx.runMutation(recordProviderAttemptRef, {
            emailId: args.emailId,
            adapter: event.adapter,
            attempt: event.attempt,
          });
        },
      });
      const message = await hydrateAttachments(email.message as EmailMessage);
      const response = await client.send(message, {
        adapter: email.adapter,
        fallbackAdapters: email.fallbackAdapters,
        idempotencyKey: email.idempotencyKey,
        metadata: email.sendMetadata,
      });

      await ctx.runMutation(markSentRef, {
        emailId: args.emailId,
        response,
      });
    } catch (error) {
      await ctx.runMutation(markFailedOrRetryRef, {
        emailId: args.emailId,
        error: stringifyError(error),
      });
    }

    return null;
  },
});

export const handleWebhook = internalAction({
  args: {
    provider: v.string(),
    headers: v.record(v.string(), v.string()),
    body: v.string(),
  },
  returns: v.object({ ok: v.boolean(), duplicate: v.optional(v.boolean()) }),
  handler: async (ctx, args) => {
    const parsed = parseProviderWebhook(args.provider, args.body, args.headers);

    return (await ctx.runMutation(recordWebhookRef, {
      provider: args.provider,
      deliveryId: parsed.deliveryId,
      providerMessageId: parsed.providerMessageId,
      payload: parsed.payload,
    })) as { ok: boolean; duplicate?: boolean };
  },
});

function stringifyError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function parseProviderWebhook(provider: string, body: string, headers: Record<string, string>) {
  const payload = parseJson(body);

  if (provider === "resend") {
    const record = payload as Record<string, unknown>;
    const data =
      typeof record.data === "object" && record.data
        ? (record.data as Record<string, unknown>)
        : {};
    const deliveryId =
      stringValue(record.id) ??
      headers["svix-id"] ??
      headers["resend-signature"] ??
      deterministicDeliveryId(provider, body);
    const providerMessageId = stringValue(data.email_id) ?? stringValue(data.id);

    return { deliveryId, providerMessageId, payload };
  }

  const record = payload as Record<string, unknown>;
  return {
    deliveryId:
      stringValue(record.id) ??
      stringValue(record.eventId) ??
      stringValue(record.webhookId) ??
      stringValue(record.deliveryId) ??
      deterministicDeliveryId(provider, body),
    providerMessageId: stringValue(record.messageId) ?? stringValue(record.message_id),
    payload,
  };
}

function parseJson(body: string) {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return { raw: body };
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function deterministicDeliveryId(provider: string, body: string) {
  return `body:${createHash("sha256").update(provider).update("\0").update(body).digest("hex")}`;
}
