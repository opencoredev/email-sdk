"use node";

import {
  EmailAdapterError,
  EmailRouteError,
  EmailSdkError,
  type EmailSendResult,
} from "@opencoredev/email-sdk";
import { normalizeWebhookEvent as normalizeSdkWebhook } from "@opencoredev/email-sdk/webhooks";
import { v } from "convex/values";
import { createHash } from "node:crypto";
import { z } from "zod";

import { action, internalAction } from "./_generated/server.js";
import {
  handleWebhookArgs,
  handleWebhookReturns,
  internalFunctions,
  processEmailArgs,
} from "./functionRefs.js";
import { buildEmailClient, hydrateAttachments } from "./providers.js";
import type { ConvexEmailProviderFailure } from "../shared/types.js";

const lib = internalFunctions.lib;

export const processEmail = internalAction({
  args: processEmailArgs,
  returns: v.null(),
  handler: async (ctx, args) => {
    const email = await ctx.runMutation(lib.markProcessing, { emailId: args.emailId });

    if (!email) {
      return null;
    }

    const processingLease = email.processingLease ?? 0;

    try {
      if (email.adapters.length === 0) {
        throw new Error("Convex Email requires at least one adapter configuration.");
      }

      const client = buildEmailClient({
        adapters: email.adapters,
        defaultAdapter: email.adapter,
        fallbackAdapters: email.fallbackAdapters,
        async recordAttempt(event) {
          await ctx.runMutation(lib.recordProviderAttempt, {
            emailId: args.emailId,
            processingLease,
            adapter: event.adapter,
            attempt: event.attempt,
          });
        },
      });

      const message = await hydrateAttachments(email.message);

      const response = await client.send(message, {
        adapter: email.adapter,
        fallback: { adapters: email.fallbackAdapters, onUnknownDelivery: "stop" },
        idempotencyKey: email.idempotencyKey,
        metadata: email.sendMetadata,
      });

      await ctx.runMutation(lib.markSent, {
        emailId: args.emailId,
        processingLease,
        response: sendResultRecord(response),
      });
    } catch (error) {
      const providerFailure = providerFailureMetadata(error);

      await ctx.runMutation(lib.markFailedOrRetry, {
        emailId: args.emailId,
        processingLease,
        error: stringifyError(error),
        retryable: providerFailure?.retryable ?? isRetryableFailure(error),
        providerFailure,
      });
    }

    return null;
  },
});

/**
 * Public inside the component so the host app can call it through `components.<name>`; component
 * functions are never reachable by browser clients directly. The app's `registerRoutes()` verifies
 * the provider signature before it calls this action.
 */
export const handleWebhook = action({
  args: handleWebhookArgs,
  returns: handleWebhookReturns,
  handler: async (ctx, args) => {
    const parsed = await parseProviderWebhook(args.provider, args.body, args.headers);

    return await ctx.runMutation(lib.recordWebhook, {
      provider: args.provider,
      deliveryId: parsed.deliveryId,
      providerMessageId: parsed.providerMessageId,
      event: parsed.event,
      payload: parsed.payload,
    });
  },
});

/** Keeps only the acknowledgement fields; the raw provider response is not stored. */
function sendResultRecord(response: EmailSendResult) {
  return {
    adapter: response.adapter,
    id: response.id,
    accepted: response.accepted ? [...response.accepted] : undefined,
    rejected: response.rejected ? [...response.rejected] : undefined,
  };
}

function stringifyError(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

function isRetryableFailure(cause: unknown) {
  return cause instanceof EmailSdkError ? cause.retryable : true;
}

function providerFailureMetadata(cause: unknown): ConvexEmailProviderFailure | undefined {
  const failure =
    cause instanceof EmailRouteError
      ? cause.failures.at(-1)
      : cause instanceof EmailAdapterError
        ? cause
        : undefined;

  if (!failure) {
    return undefined;
  }

  const metadata: ConvexEmailProviderFailure = {
    adapter: failure.adapter,
    retryable: failure.retryable,
    delivery: failure.delivery,
  };

  if (failure.requestId) {
    metadata.requestId = failure.requestId;
  }

  if (failure.acceptedCount !== undefined) {
    metadata.acceptedCount = failure.acceptedCount;
  }

  if (failure.rejectedCount !== undefined) {
    metadata.rejectedCount = failure.rejectedCount;
  }

  return metadata;
}

async function parseProviderWebhook(provider: string, body: string, headers: Record<string, string>) {
  if (provider === "resend" || provider === "postmark" || provider === "mailgun") {
    const parsed = await normalizeSdkWebhook({ provider, body, headers });

    return {
      deliveryId: parsed.deliveryId,
      providerMessageId: parsed.providerMessageId,
      event: parsed.status ?? parsed.type,
      payload: parsed.payload,
    };
  }

  return parseGenericWebhook(provider, body);
}

/** A field that is read only when it holds a string; anything else counts as absent. */
const looseString = z.string().optional().catch(undefined);

// Postmark's dedupe id arrives as a numeric uppercase `ID`; accept numbers as well as strings.
const looseId = z
  .union([z.string(), z.number().transform(String)])
  .optional()
  .catch(undefined);

// Mailgun nests the event under `event-data`, with the original Message-ID in its message headers.
const genericEventData = z.object({
  event: looseString,
  severity: looseString,
  id: looseString,
  message: z
    .object({
      headers: z.object({ "message-id": looseString }).optional().catch(undefined),
    })
    .optional()
    .catch(undefined),
});

/** The fields the generic webhook path understands, across the providers it has seen. */
const genericWebhookFields = z
  .object({
    event: looseString,
    type: looseString,
    RecordType: looseString,
    Type: looseString,
    id: looseString,
    ID: looseId,
    eventId: looseString,
    webhookId: looseString,
    deliveryId: looseString,
    messageId: looseString,
    message_id: looseString,
    MessageID: looseString,
    "event-data": genericEventData.optional().catch(undefined),
  })
  .catch({});

const jsonPayload = z.json();

function parseGenericWebhook(provider: string, body: string) {
  const payload = parseJsonPayload(body);
  const record = genericWebhookFields.parse(payload);
  const eventData = record["event-data"];

  const event = normalizeWebhookEvent(
    record.event ?? record.type ?? record.RecordType ?? eventData?.event,
    {
      // Mailgun marks failure events with event-data.severity: "permanent" | "temporary".
      severity: eventData?.severity,
      // Postmark bounce webhooks carry the bounce class in Type (e.g. "HardBounce", "Transient").
      bounceType: record.Type,
    },
  );

  return {
    deliveryId:
      record.id ??
      record.ID ??
      record.eventId ??
      record.webhookId ??
      record.deliveryId ??
      eventData?.id ??
      deterministicDeliveryId(provider, body),
    providerMessageId:
      record.messageId ??
      record.message_id ??
      record.MessageID ??
      eventData?.message?.headers?.["message-id"],
    event,
    payload,
  };
}

function parseJsonPayload(body: string) {
  try {
    return jsonPayload.parse(JSON.parse(body));
  } catch {
    return { raw: body };
  }
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

function deterministicDeliveryId(provider: string, body: string) {
  return `body:${createHash("sha256").update(provider).update("\0").update(body).digest("hex")}`;
}
