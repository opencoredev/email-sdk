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
  vCancelEmailArgs,
  vEmailConfig,
  vEmailEventRecord,
  vEmailRecord,
  vEmailWebhookArgs,
  vEmailWebhookResult,
  vListEmailEventsArgs,
  vRetryEmailArgs,
  vSendBatchEmailsArgs,
  vSendEmailArgs,
  vStatusArgs,
} from "./validators.js";

const vOwnedEmailArgs = { email: v.object(vSendEmailArgs), ownerId: v.string() };

const vOwnedBatchArgs = { messages: v.array(v.object(vSendEmailArgs)), ownerId: v.string() };

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
    enqueue: ComponentRef<"mutation", typeof vSendEmailArgs, typeof vEmailId, TName>;
    enqueueOwned: ComponentRef<"mutation", typeof vOwnedEmailArgs, typeof vEmailId, TName>;
    enqueueOwnedBatch: ComponentRef<"mutation", typeof vOwnedBatchArgs, typeof vEmailIds, TName>;
    enqueueBatch: ComponentRef<"mutation", typeof vSendBatchEmailsArgs, typeof vEmailIds, TName>;
    status: ComponentRef<"query", typeof vStatusArgs, typeof vMaybeEmailRecord, TName>;
    listEvents: ComponentRef<
      "query",
      typeof vListEmailEventsArgs,
      typeof vEmailEventRecords,
      TName
    >;
    cancel: ComponentRef<"mutation", typeof vCancelEmailArgs, typeof vFlag, TName>;
    retry: ComponentRef<"mutation", typeof vRetryEmailArgs, typeof vFlag, TName>;
    setConfig: ComponentRef<"mutation", typeof vSetConfigArgs, typeof vNull, TName>;
    getConfig: ComponentRef<"query", typeof vNoArgs, typeof vMaybeEmailConfig, TName>;
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
