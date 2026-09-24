import { v } from "convex/values";
import type { GenericValidator, PropertyValidators, Validator } from "convex/values";

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
export const vAdapterConfig = adapterConfigValidator();

function adapterConfigValidator(): Validator<ConvexEmailAdapterConfig, "required", string> {
  const [first, second, ...rest] = Object.entries(CONVEX_EMAIL_ADAPTERS).map(([kind, fields]) =>
    adapterObjectValidator(kind, fields),
  );

  if (!first || !second) {
    throw new Error("CONVEX_EMAIL_ADAPTERS must describe at least two adapters.");
  }

  // SAFETY: each object validator is generated from the same CONVEX_EMAIL_ADAPTERS entry that
  // ConvexEmailAdapterConfig derives its member type from (kind literal, optional name, `<field>Env`
  // for env-backed fields, and inline fields typed by ConvexAdapterFieldValue). adapters.test.ts
  // checks the generated validator against the registry, so the runtime union and the static type
  // describe the same values.
  return v.union(first, second, ...rest) as Validator<ConvexEmailAdapterConfig, "required", string>;
}

function adapterObjectValidator(kind: string, fields: ConvexAdapterFields): GenericValidator {
  return v.object(adapterConfigFields(kind, fields));
}

function adapterConfigFields(kind: string, fields: ConvexAdapterFields) {
  const validators: PropertyValidators = {
    kind: v.literal(kind),
    name: v.optional(v.string()),
  };

  for (const [key, field] of Object.entries(fields)) {
    if (field.env) {
      validators[`${key}Env`] = v.optional(v.string());
    }

    if (field.inline) {
      validators[key] = v.optional(vAdapterFieldValue(field));
    }
  }

  return validators;
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

export const vEmailWebhookResult = v.object({
  ok: v.boolean(),
  duplicate: v.optional(v.boolean()),
});

export const vEmailWebhookArgs = {
  provider: v.string(),
  headers: v.record(v.string(), v.string()),
  body: v.string(),
};

/** The provider acknowledgement the worker records when a send succeeds. */
export const vEmailSendResult = v.object({
  adapter: v.string(),
  id: v.optional(v.string()),
  accepted: v.optional(v.array(v.string())),
  rejected: v.optional(v.array(v.string())),
});

const emailRecordFields = {
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
  processingLease: v.optional(v.number()),
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
};

/** An email document as the component reads it, keyed by its own table id. */
export const vStoredEmail = v.object({ _id: v.id("emails"), ...emailRecordFields });

/**
 * The same email as an app sees it. Component table ids cross the component boundary as plain
 * strings, so app-side functions must not validate them against the app's own tables.
 */
export const vEmailRecord = v.object({ _id: v.string(), ...emailRecordFields });

const emailEventRecordFields = {
  _creationTime: v.number(),
  type: vEmailEventType,
  adapter: v.optional(v.string()),
  attempt: v.optional(v.number()),
  providerMessageId: v.optional(v.string()),
  payload: v.optional(v.any()),
  error: v.optional(v.string()),
  createdAt: v.number(),
};

export const vStoredEmailEvent = v.object({
  _id: v.id("emailEvents"),
  emailId: v.id("emails"),
  ...emailEventRecordFields,
});

/** An email event as an app sees it; see `vEmailRecord` for why ids are strings here. */
export const vEmailEventRecord = v.object({
  _id: v.string(),
  emailId: v.string(),
  ...emailEventRecordFields,
});
