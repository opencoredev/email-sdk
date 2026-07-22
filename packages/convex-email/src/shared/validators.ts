import { v } from "convex/values";

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

const vOptionalName = {
  name: v.optional(v.string()),
};

const vApiKeyEnvAdapter = <TKind extends string>(kind: TKind) =>
  v.object({
    kind: v.literal(kind),
    ...vOptionalName,
    apiKeyEnv: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  });

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

export const vAdapterConfig = v.union(
  v.object({
    kind: v.literal("memory"),
    name: v.optional(v.string()),
  }),
  vApiKeyEnvAdapter("brevo"),
  v.object({
    kind: v.literal("cloudflare"),
    ...vOptionalName,
    apiTokenEnv: v.optional(v.string()),
    accountIdEnv: v.optional(v.string()),
    accountId: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("iterable"),
    ...vOptionalName,
    apiKeyEnv: v.optional(v.string()),
    campaignIdEnv: v.optional(v.string()),
    campaignId: v.optional(v.number()),
    allowRepeatMarketingSends: v.optional(v.boolean()),
    dataFields: v.optional(vEmailMetadata),
    sendAt: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("loops"),
    ...vOptionalName,
    apiKeyEnv: v.optional(v.string()),
    transactionalIdEnv: v.optional(v.string()),
    transactionalId: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
  vApiKeyEnvAdapter("mailchimp"),
  vApiKeyEnvAdapter("mailersend"),
  v.object({
    kind: v.literal("mailgun"),
    ...vOptionalName,
    apiKeyEnv: v.optional(v.string()),
    domainEnv: v.optional(v.string()),
    domain: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
  vApiKeyEnvAdapter("mailpace"),
  vApiKeyEnvAdapter("mailtrap"),
  vApiKeyEnvAdapter("plunk"),
  v.object({
    kind: v.literal("resend"),
    name: v.optional(v.string()),
    apiKeyEnv: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("postmark"),
    name: v.optional(v.string()),
    serverTokenEnv: v.optional(v.string()),
    messageStream: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("sendgrid"),
    name: v.optional(v.string()),
    apiKeyEnv: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("ses"),
    name: v.optional(v.string()),
    accessKeyIdEnv: v.optional(v.string()),
    secretAccessKeyEnv: v.optional(v.string()),
    sessionTokenEnv: v.optional(v.string()),
    regionEnv: v.optional(v.string()),
    region: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
  v.object({
    kind: v.literal("scaleway"),
    ...vOptionalName,
    secretKeyEnv: v.optional(v.string()),
    projectIdEnv: v.optional(v.string()),
    projectId: v.optional(v.string()),
    regionEnv: v.optional(v.string()),
    region: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
  vApiKeyEnvAdapter("sequenzy"),
  v.object({
    kind: v.literal("smtp"),
    name: v.optional(v.string()),
    hostEnv: v.optional(v.string()),
    portEnv: v.optional(v.string()),
    secureEnv: v.optional(v.string()),
    userEnv: v.optional(v.string()),
    passEnv: v.optional(v.string()),
    host: v.optional(v.string()),
    port: v.optional(v.number()),
    secure: v.optional(v.boolean()),
  }),
  vApiKeyEnvAdapter("sparkpost"),
  vApiKeyEnvAdapter("unosend"),
  v.object({
    kind: v.literal("zeptomail"),
    ...vOptionalName,
    tokenEnv: v.optional(v.string()),
    baseUrl: v.optional(v.string()),
  }),
);

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

export const vStoredEmail = v.object({
  _id: v.id("emails"),
  _creationTime: v.number(),
  status: vEmailStatusValue,
  message: v.object(vEmailMessage),
  adapter: v.optional(v.string()),
  attemptedAdapters: v.array(v.string()),
  fallbackAdapters: v.array(v.string()),
  adapters: v.array(vAdapterConfig),
  providerMessageId: v.optional(v.string()),
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
