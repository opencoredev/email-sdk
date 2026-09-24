/**
 * Typed references to the component's internal functions.
 *
 * The committed `_generated/api.ts` is a generic stub (`internal: AnyApi`), so every call site used
 * to cast its own reference type. The argument and return validators for each internal function
 * live here instead: `lib.ts` and `worker.ts` define their functions with these exact validators,
 * and the reference types below are derived from the same values, so the two cannot drift.
 *
 * This module runs in the default Convex runtime; it must not import Node or Email SDK code.
 */
import { makeFunctionReference } from "convex/server";
import type { FunctionReference, FunctionVisibility } from "convex/server";
import { v } from "convex/values";
import type { GenericValidator, Infer, ObjectType, PropertyValidators } from "convex/values";

import {
  vEmailProviderFailure,
  vEmailSendResult,
  vEmailWebhookArgs,
  vEmailWebhookResult,
  vStoredEmail,
} from "../shared/validators.js";

export const markProcessingArgs = { emailId: v.id("emails") };

export const markProcessingReturns = v.union(vStoredEmail, v.null());

export const recordProviderAttemptArgs = {
  emailId: v.id("emails"),
  processingLease: v.number(),
  adapter: v.string(),
  attempt: v.number(),
};

export const markSentArgs = {
  emailId: v.id("emails"),
  processingLease: v.number(),
  response: vEmailSendResult,
};

export const markFailedOrRetryArgs = {
  emailId: v.id("emails"),
  processingLease: v.number(),
  error: v.string(),
  retryable: v.boolean(),
  providerFailure: v.optional(vEmailProviderFailure),
};

export const recordWebhookArgs = {
  provider: v.string(),
  deliveryId: v.string(),
  providerMessageId: v.optional(v.string()),
  event: v.optional(v.string()),
  // Opaque provider JSON, stored for debugging on the email's event history.
  payload: v.any(),
};

export const sweepArgs = { limit: v.optional(v.number()) };

export const processEmailArgs = { emailId: v.id("emails") };

export const handleWebhookArgs = vEmailWebhookArgs;

export const handleWebhookReturns = vEmailWebhookResult;

/**
 * Convex only tracks visibility in the type system, and `makeFunctionReference` always reports
 * "public". Callers (`runMutation`, the scheduler, crons) accept either visibility, so the alias
 * allows both rather than claiming a narrower marker than the reference object carries.
 */
type InternalRef<
  TType extends "mutation" | "action",
  TArgs extends PropertyValidators,
  TReturns extends GenericValidator,
> = FunctionReference<TType, FunctionVisibility, ObjectType<TArgs>, Infer<TReturns>>;

function internalRef<
  TType extends "mutation" | "action",
  TArgs extends PropertyValidators,
  TReturns extends GenericValidator,
>(name: string): InternalRef<TType, TArgs, TReturns> {
  return makeFunctionReference<TType, ObjectType<TArgs>, Infer<TReturns>>(name);
}

type BooleanReturns = ReturnType<typeof v.boolean>;

type NumberReturns = ReturnType<typeof v.number>;

type NullReturns = ReturnType<typeof v.null>;

/**
 * References to the internal functions in lib.ts and worker.ts. Each one is typed from the same
 * validators its function is registered with.
 */
export const internalFunctions = {
  lib: {
    markProcessing: internalRef<
      "mutation",
      typeof markProcessingArgs,
      typeof markProcessingReturns
    >("lib:markProcessing"),
    recordProviderAttempt: internalRef<
      "mutation",
      typeof recordProviderAttemptArgs,
      BooleanReturns
    >("lib:recordProviderAttempt"),
    markSent: internalRef<"mutation", typeof markSentArgs, BooleanReturns>("lib:markSent"),
    markFailedOrRetry: internalRef<"mutation", typeof markFailedOrRetryArgs, BooleanReturns>(
      "lib:markFailedOrRetry",
    ),
    recordWebhook: internalRef<"mutation", typeof recordWebhookArgs, typeof handleWebhookReturns>(
      "lib:recordWebhook",
    ),
    processDueEmails: internalRef<"mutation", typeof sweepArgs, NumberReturns>(
      "lib:processDueEmails",
    ),
    cleanupExpiredEmails: internalRef<"mutation", typeof sweepArgs, NumberReturns>(
      "lib:cleanupExpiredEmails",
    ),
  },
  worker: {
    processEmail: internalRef<"action", typeof processEmailArgs, NullReturns>(
      "worker:processEmail",
    ),
  },
};
