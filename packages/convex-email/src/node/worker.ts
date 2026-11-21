import {
  EmailAdapterError,
  EmailRouteError,
  EmailSdkError,
  type EmailSendResult,
} from "@opencoredev/email-sdk";
import type { GenericActionCtx, GenericDataModel } from "convex/server";

import { buildEmailClient, hydrateAttachments, type AdapterEnv } from "./providers.js";
import type { ConvexEmailComponentApi } from "../shared/componentApi.js";
import type { ConvexEmailProviderFailure } from "../shared/types.js";

export type ProcessEmailOptions = {
  ctx: Pick<GenericActionCtx<GenericDataModel>, "runMutation">;
  component: ConvexEmailComponentApi;
  emailId: string;
  telemetry?: boolean;
  env?: AdapterEnv;
};

/**
 * One send attempt for a queued email: take the processing lease, send through the Email SDK, and
 * report the outcome back to the component. Runs in the app's Node action, never in the component.
 */
export async function processEmail(options: ProcessEmailOptions) {
  const { ctx, component, emailId } = options;
  const lib = component.lib;
  const email = await ctx.runMutation(lib.markProcessing, { emailId });

  if (!email) {
    return;
  }

  const processingLease = email.processingLease ?? 0;
  // The adapter this run last sent a request to, set only after the attempt was recorded.
  let lastDispatchedAdapter: string | undefined;

  try {
    if (email.adapters.length === 0) {
      throw new Error("Convex Email requires at least one adapter configuration.");
    }

    // After an attempt whose outcome is unknown, retry only that adapter: another provider
    // could deliver a second copy, and the idempotency key only deduplicates within one provider.
    const pinnedAdapter = email.unknownDeliveryAdapter;
    const adapter = pinnedAdapter ?? email.adapter;
    const fallbackAdapters = pinnedAdapter ? [] : email.fallbackAdapters;

    const client = buildEmailClient({
      adapters: email.adapters,
      defaultAdapter: adapter,
      fallbackAdapters,
      telemetry: options.telemetry,
      env: options.env,
      async recordAttempt(event) {
        const recorded = await ctx.runMutation(lib.recordProviderAttempt, {
          emailId,
          processingLease,
          adapter: event.adapter,
          attempt: event.attempt,
        });

        if (!recorded) {
          throw new Error("Convex Email lost the processing lease before sending.");
        }

        lastDispatchedAdapter = event.adapter;
      },
    });

    const message = await hydrateAttachments(email.message);

    const response = await client.send(message, {
      adapter,
      fallback: { adapters: fallbackAdapters, onUnknownDelivery: "stop" },
      idempotencyKey: email.idempotencyKey,
      metadata: email.sendMetadata,
    });

    await ctx.runMutation(lib.markSent, {
      emailId,
      processingLease,
      response: sendResultRecord(response),
    });
  } catch (error) {
    const providerFailure = providerFailureMetadata(error);

    // Anything short of a proven not_sent may have delivered: an unknown provider failure, or an
    // error with no provider metadata after a request went out (such as markSent failing after
    // the provider accepted the message). Pin the registered name recorded at dispatch: a
    // provider's error can carry its factory name, which may be another adapter's alias.
    const unknownDeliveryAdapter =
      providerFailure?.delivery === "not_sent" ? undefined : lastDispatchedAdapter;

    await ctx.runMutation(lib.markFailedOrRetry, {
      emailId,
      processingLease,
      error: stringifyError(error),
      retryable: providerFailure?.retryable ?? isRetryableFailure(error),
      providerFailure,
      unknownDeliveryAdapter,
    });
  }
}

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
