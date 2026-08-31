import { v } from "convex/values";
import type { GenericValidator, Validator } from "convex/values";

import {
  CONVEX_EMAIL_ADAPTERS,
  type ConvexAdapterField,
  type ConvexAdapterFields,
} from "./adapters.js";
import type { ConvexEmailAdapterConfig } from "./types.js";

export const vEmailAddress = v.union(
  v.string(),
  v.object({
    email: v.string(),
    name: v.optional(v.string()),
  }),
);

export const vOneOrManyEmailAddress = v.union(vEmailAddress, v.array(vEmailAddress));

export const vEmailHeader = v.object({
  name: v.string(),
  value: v.string(),
});

export const vEmailTag = v.object({
  name: v.string(),
  value: v.string(),
});

export const vEmailAttachment = v.object({
  filename: v.string(),
  content: v.optional(v.string()),
  contentEncoding: v.optional(v.union(v.literal("raw"), v.literal("base64"))),
  url: v.optional(v.string()),
  contentType: v.optional(v.string()),
  contentId: v.optional(v.string()),
  disposition: v.optional(v.union(v.literal("attachment"), v.literal("inline"))),
});

export const vEmailMetadata = v.record(
  v.string(),
  v.union(v.string(), v.number(), v.boolean(), v.null()),
);

export const vEmailMessage = {
  from: vEmailAddress,
  to: vOneOrManyEmailAddress,
  subject: v.string(),
  html: v.optional(v.string()),
  text: v.optional(v.string()),
  cc: v.optional(vOneOrManyEmailAddress),
  bcc: v.optional(vOneOrManyEmailAddress),
  replyTo: v.optional(vOneOrManyEmailAddress),
  headers: v.optional(v.union(v.record(v.string(), v.string()), v.array(vEmailHeader))),
  attachments: v.optional(v.array(vEmailAttachment)),
  tags: v.optional(v.array(vEmailTag)),
  metadata: v.optional(vEmailMetadata),
  idempotencyKey: v.optional(v.string()),
};

/**
 * Wire validator for adapter configuration, generated from `CONVEX_EMAIL_ADAPTERS`. Each field
 * contributes an optional `<field>Env` key when it can be read from the component environment and
 * an optional literal key when it is safe to store inline.
 */
export const vAdapterConfig = v.union(
  ...(Object.entries(CONVEX_EMAIL_ADAPTERS as Record<string, ConvexAdapterFields>).map(
    ([kind, fields]) => v.object(adapterConfigShape(kind, fields)),
  ) as [GenericValidator, GenericValidator, ...GenericValidator[]]),
) as unknown as Validator<ConvexEmailAdapterConfig, "required", never>;

function adapterConfigShape(kind: string, fields: ConvexAdapterFields) {
  const shape: Record<string, GenericValidator> = {
    kind: v.literal(kind),
    name: v.optional(v.string()),
  };

  for (const [key, field] of Object.entries(fields)) {
    if (field.env) {
      shape[`${key}Env`] = v.optional(v.string());
    }
    if (field.inline) {
      shape[key] = v.optional(vAdapterFieldValue(field));
    }
  }

  return shape;
}

function vAdapterFieldValue(field: ConvexAdapterField): GenericValidator {
  switch (field.type) {
    case "number":
      return v.number();
    case "boolean":
      return v.boolean();
    case "record":
      return vEmailMetadata;
    default:
      return v.string();
  }
}

export const vSendEmailArgs = {
  ...vEmailMessage,
  from: v.optional(vEmailAddress),
  adapter: v.optional(v.string()),
  fallbackAdapters: v.optional(v.array(v.string())),
  retries: v.optional(v.number()),
  maxAttempts: v.optional(v.number()),
  retryBaseMs: v.optional(v.number()),
  adapters: v.optional(v.array(vAdapterConfig)),
  sendMetadata: v.optional(vEmailMetadata),
};

export const vSendBatchEmailsArgs = {
  messages: v.array(v.object(vSendEmailArgs)),
};

export const vStatusArgs = {
  emailId: v.string(),
};

export const vListEmailEventsArgs = {
  emailId: v.string(),
};

export const vCancelEmailArgs = {
  emailId: v.string(),
};

export const vRetryEmailArgs = {
  emailId: v.string(),
};

export const vEmailConfig = v.object({
  testMode: v.optional(v.boolean()),
  sandboxTo: v.optional(v.array(v.string())),
  defaultFrom: v.optional(v.string()),
  maxAttempts: v.optional(v.number()),
  retryBaseMs: v.optional(v.number()),
  cleanupAfterDays: v.optional(v.number()),
});

export const vDeliveryStatusValue = v.union(
  v.literal("delivered"),
  v.literal("bounced"),
  v.literal("complained"),
);

export const vEmailStatusValue = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("sent"),
  v.literal("failed"),
  v.literal("canceled"),
);

export const vEmailEventType = v.union(
  v.literal("queued"),
  v.literal("processing"),
  v.literal("provider_attempt"),
  v.literal("sent"),
  v.literal("retry_scheduled"),
  v.literal("failed"),
  v.literal("canceled"),
  v.literal("webhook"),
);

export const vEmailProviderFailure = v.object({
  adapter: v.string(),
  requestId: v.optional(v.string()),
  retryable: v.boolean(),
  delivery: v.union(v.literal("not_sent"), v.literal("unknown")),
  acceptedCount: v.optional(v.number()),
  rejectedCount: v.optional(v.number()),
});

export const vStoredEmail = v.object({
  _id: v.id("emails"),
  _creationTime: v.number(),
  status: vEmailStatusValue,
  message: v.object(vEmailMessage),
  ownerId: v.optional(v.string()),
  adapter: v.optional(v.string()),
  attemptedAdapters: v.array(v.string()),
  fallbackAdapters: v.array(v.string()),
  adapters: v.array(vAdapterConfig),
  providerMessageId: v.optional(v.string()),
  providerFailure: v.optional(vEmailProviderFailure),
  idempotencyKey: v.optional(v.string()),
  sendMetadata: v.optional(vEmailMetadata),
  attemptCount: v.number(),
  maxAttempts: v.number(),
  retryBaseMs: v.number(),
  nextAttemptAt: v.optional(v.number()),
  lastError: v.optional(v.string()),
  deliveryStatus: v.optional(vDeliveryStatusValue),
  deliveredAt: v.optional(v.number()),
  createdAt: v.number(),
  updatedAt: v.number(),
  sentAt: v.optional(v.number()),
  terminalAt: v.optional(v.number()),
});

export const vStoredEmailEvent = v.object({
  _id: v.id("emailEvents"),
  _creationTime: v.number(),
  emailId: v.id("emails"),
  type: vEmailEventType,
  adapter: v.optional(v.string()),
  attempt: v.optional(v.number()),
  providerMessageId: v.optional(v.string()),
  payload: v.optional(v.any()),
  error: v.optional(v.string()),
  createdAt: v.number(),
});
