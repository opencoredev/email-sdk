/**
 * The typed shape of the component as an app sees it through `components.<name>`.
 *
 * Convex codegen would normally write this into `_generated/component.ts`, but that file is a
 * committed stub in this package (codegen needs a live deployment). Every argument and return type
 * below is derived from the validators the component registers its public functions with, so the
 * client and the component cannot disagree about a payload.
 */
import type { FunctionReference } from "convex/server";
import type { Infer, ObjectType, PropertyValidators, Validator } from "convex/values";
import { v } from "convex/values";

import {
  markFailedOrRetryArgs,
  markSentArgs,
  recordProviderAttemptArgs,
} from "../component/functionRefs.js";
import {
  vCancelEmailArgs,
  vEmailConfig,
  vEmailEventRecord,
  vEmailRecord,
  vEmailWebhookArgs,
  vEmailWebhookResult,
  vEnqueueBatchArgs,
  vEnqueueEmailArgs,
  vEnqueueOwnedArgs,
  vEnqueueOwnedBatchArgs,
  vListEmailEventsArgs,
  vRetryWithSenderArgs,
  vStatusArgs,
} from "./validators.js";

// The lease mutations take the component's own `emails` id, which reaches the app as a string.
const vAppEmailId = { emailId: v.string() };

const vMarkProcessingArgs = vAppEmailId;

const vRecordProviderAttemptArgs = { ...recordProviderAttemptArgs, ...vAppEmailId };

const vMarkSentArgs = { ...markSentArgs, ...vAppEmailId };

const vMarkFailedOrRetryArgs = { ...markFailedOrRetryArgs, ...vAppEmailId };

const vSetConfigArgs = { config: vEmailConfig };

const vNoArgs = {};

const vEmailId = v.string();

const vEmailIds = v.array(v.string());

const vFlag = v.boolean();

const vNull = v.null();

const vMaybeEmailRecord = v.union(vEmailRecord, v.null());

const vEmailEventRecords = v.array(vEmailEventRecord);

const vMaybeEmailConfig = v.union(vEmailConfig, v.null());

type ComponentRef<
  TType extends "query" | "mutation" | "action",
  TArgs extends PropertyValidators,
  TReturns extends Validator<unknown, "required", string>,
  TName extends string | undefined,
> = FunctionReference<TType, "internal", ObjectType<TArgs>, Infer<TReturns>, TName>;

export type ConvexEmailComponentApi<TName extends string | undefined = string | undefined> = {
  lib: {
    enqueue: ComponentRef<"mutation", typeof vEnqueueEmailArgs, typeof vEmailId, TName>;
    enqueueOwned: ComponentRef<"mutation", typeof vEnqueueOwnedArgs, typeof vEmailId, TName>;
    enqueueOwnedBatch: ComponentRef<
      "mutation",
      typeof vEnqueueOwnedBatchArgs,
      typeof vEmailIds,
      TName
    >;
    enqueueBatch: ComponentRef<"mutation", typeof vEnqueueBatchArgs, typeof vEmailIds, TName>;
    status: ComponentRef<"query", typeof vStatusArgs, typeof vMaybeEmailRecord, TName>;
    listEvents: ComponentRef<
      "query",
      typeof vListEmailEventsArgs,
      typeof vEmailEventRecords,
      TName
    >;
    cancel: ComponentRef<"mutation", typeof vCancelEmailArgs, typeof vFlag, TName>;
    retry: ComponentRef<"mutation", typeof vRetryWithSenderArgs, typeof vFlag, TName>;
    setConfig: ComponentRef<"mutation", typeof vSetConfigArgs, typeof vNull, TName>;
    getConfig: ComponentRef<"query", typeof vNoArgs, typeof vMaybeEmailConfig, TName>;
    markProcessing: ComponentRef<
      "mutation",
      typeof vMarkProcessingArgs,
      typeof vMaybeEmailRecord,
      TName
    >;
    recordProviderAttempt: ComponentRef<
      "mutation",
      typeof vRecordProviderAttemptArgs,
      typeof vFlag,
      TName
    >;
    markSent: ComponentRef<"mutation", typeof vMarkSentArgs, typeof vFlag, TName>;
    markFailedOrRetry: ComponentRef<"mutation", typeof vMarkFailedOrRetryArgs, typeof vFlag, TName>;
  };
  worker: {
    handleWebhook: ComponentRef<
      "action",
      typeof vEmailWebhookArgs,
      typeof vEmailWebhookResult,
      TName
    >;
  };
};
