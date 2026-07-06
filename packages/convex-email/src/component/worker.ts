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
      event: parsed.event,
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
    const event = normalizeWebhookEvent(stringValue(record.type));

    return { deliveryId, providerMessageId, event, payload };
  }

  const record = payload as Record<string, unknown>;
  const eventData =
    typeof record["event-data"] === "object" && record["event-data"]
      ? (record["event-data"] as Record<string, unknown>)
      : undefined;
  const event = normalizeWebhookEvent(
    stringValue(record.event) ??
      stringValue(record.type) ??
      stringValue(record.RecordType) ??
      stringValue(eventData?.event),
    {
      // Mailgun marks failure events with event-data.severity: "permanent" | "temporary".
      severity: stringValue(eventData?.severity),
      // Postmark bounce webhooks carry the bounce class in Type (e.g. "HardBounce", "Transient").
      bounceType: stringValue(record.Type),
    },
  );

  return {
    deliveryId:
      stringValue(record.id) ??
      idValue(record.ID) ??
      stringValue(record.eventId) ??
      stringValue(record.webhookId) ??
      stringValue(record.deliveryId) ??
      stringValue(eventData?.id) ??
      deterministicDeliveryId(provider, body),
    providerMessageId:
      stringValue(record.messageId) ??
      stringValue(record.message_id) ??
      stringValue(record.MessageID) ??
      eventDataMessageId(eventData),
    event,
    payload,
  };
}

// Postmark bounce Types that indicate a permanent/hard failure. Everything else
// ("Transient", "SoftBounce", "DnsError", ...) is retried by Postmark and may still deliver,
// so it must not set deliveryStatus. See Postmark's bounce-type table.
const permanentPostmarkBounceTypes = new Set([
  "hardbounce",
  "bademailaddress",
  "manuallydeactivated",
]);

// Maps provider-specific webhook event names onto the component's delivery vocabulary:
// "delivered" | "bounced" | "complained". Unknown events pass through lowercased so they are
// still stored on the delivery record, but only the three known values touch deliveryStatus.
// Soft/temporary failures deliberately stay unmapped: Mailgun "failed" only counts as bounced
// when severity is "permanent", and Postmark "Bounce" only when Type is a permanent class.
function normalizeWebhookEvent(
  value: string | undefined,
  context: { severity?: string; bounceType?: string } = {},
) {
  if (!value) {
    return undefined;
  }

  const event = value.toLowerCase().replace(/^email\./, "");

  switch (event) {
    case "delivered":
    case "delivery":
      return "delivered";
    case "failed":
      // Mailgun fires event "failed" for both hard and soft bounces; severity disambiguates.
      // Temporary failures are retried by Mailgun, so leave them stored-but-unmapped.
      return context.severity?.toLowerCase() === "permanent" ? "bounced" : event;
    case "bounce":
      // Postmark fires RecordType "Bounce" for hard AND soft bounces. Only permanent Types
      // become "bounced"; a Transient bounce may still end in a later Delivery webhook.
      if (context.bounceType !== undefined) {
        return permanentPostmarkBounceTypes.has(context.bounceType.toLowerCase())
          ? "bounced"
          : event;
      }
      return "bounced";
    case "bounced":
    case "permanent_fail":
      return "bounced";
    case "complained":
    case "complaint":
    case "spamcomplaint":
    case "spam_complaint":
    case "spamreport":
      return "complained";
    default:
      return event;
  }
}

// Mailgun nests the original Message-ID under event-data.message.headers["message-id"].
function eventDataMessageId(eventData: Record<string, unknown> | undefined) {
  if (!eventData || typeof eventData.message !== "object" || !eventData.message) {
    return undefined;
  }

  const message = eventData.message as Record<string, unknown>;
  if (typeof message.headers !== "object" || !message.headers) {
    return undefined;
  }

  return stringValue((message.headers as Record<string, unknown>)["message-id"]);
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

// Postmark's dedupe id arrives as a numeric uppercase `ID`; accept numbers as well as strings.
function idValue(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  return typeof value === "number" && Number.isFinite(value) ? String(value) : undefined;
}

function deterministicDeliveryId(provider: string, body: string) {
  return `body:${createHash("sha256").update(provider).update("\0").update(body).digest("hex")}`;
}
