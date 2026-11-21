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
import type { FunctionHandle, FunctionReference, FunctionVisibility } from "convex/server";
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
  unknownDeliveryAdapter: v.optional(v.string()),
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

/** Arguments of the app's sender action, which the component schedules once per send attempt. */
export const senderArgs = { emailId: v.string() };

/** A function handle to the app's sender action, created by the app-side `ConvexEmail` client. */
export type SenderHandle = FunctionHandle<"action", ObjectType<typeof senderArgs>, null>;

/** Turns the handle string stored on an email back into a schedulable reference. */
export function senderHandle(handle: string): SenderHandle {
  // SAFETY: the only writer of `emails.sender` is enqueue, whose `sender` argument comes from the
  // app-side client's `createFunctionHandle(options.sender)`. That option is typed as an action
  // taking `{ emailId: string }` and returning null, which is exactly SenderHandle.
  return handle as SenderHandle;
}

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

type NumberReturns = ReturnType<typeof v.number>;

/**
 * References to the internal functions in lib.ts. Each one is typed from the same validators its
 * function is registered with.
 */
export const internalFunctions = {
  lib: {
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
};
