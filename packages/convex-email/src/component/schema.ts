import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

import {
  vAdapterConfig,
  vDeliveryStatusValue,
  vEmailEventType,
  vEmailMessage,
  vEmailMetadata,
  vEmailStatusValue,
} from "../shared/validators.js";

export default defineSchema({
  emails: defineTable({
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
  })
    .index("by_status_and_nextAttemptAt", ["status", "nextAttemptAt"])
    .index("by_status_and_updatedAt", ["status", "updatedAt"])
    .index("by_idempotencyKey", ["idempotencyKey"])
    .index("by_createdAt", ["createdAt"])
    .index("by_terminalAt", ["terminalAt"])
    .index("by_providerMessageId", ["providerMessageId"]),

  emailEvents: defineTable({
    emailId: v.id("emails"),
    type: vEmailEventType,
    adapter: v.optional(v.string()),
    attempt: v.optional(v.number()),
    providerMessageId: v.optional(v.string()),
    payload: v.optional(v.any()),
    error: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_emailId_and_createdAt", ["emailId", "createdAt"])
    .index("by_type_and_createdAt", ["type", "createdAt"]),

  webhookDeliveries: defineTable({
    provider: v.string(),
    deliveryId: v.string(),
    emailId: v.optional(v.id("emails")),
    providerMessageId: v.optional(v.string()),
    event: v.optional(v.string()),
    receivedAt: v.number(),
    processedAt: v.optional(v.number()),
    status: v.union(v.literal("processed"), v.literal("ignored"), v.literal("failed")),
    error: v.optional(v.string()),
  })
    .index("by_provider_and_deliveryId", ["provider", "deliveryId"])
    .index("by_emailId", ["emailId"])
    .index("by_receivedAt", ["receivedAt"]),

  config: defineTable({
    key: v.string(),
    testMode: v.optional(v.boolean()),
    sandboxTo: v.optional(v.array(v.string())),
    defaultFrom: v.optional(v.string()),
    maxAttempts: v.optional(v.number()),
    retryBaseMs: v.optional(v.number()),
    cleanupAfterDays: v.optional(v.number()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),
});
