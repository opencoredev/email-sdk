import {
  EmailAbortError,
  EmailAdapterError,
  EmailMiddlewareError,
  EmailSdkError,
  EmailValidationError,
  isRetryableEmailError,
} from "../errors.js";
import { cloneMetadataRecord, isFunction } from "../internal/decode.js";
import { snapshotMessage, snapshotNativeObject } from "../internal/snapshot.js";
import type {
  EmailAdapter,
  EmailHooks,
  EmailMessage,
  EmailNativeObject,
  EmailRetryConfig,
  EmailSendMiddleware,
  EmailNativeSendOptions,
  EmailSendResult,
} from "../types.js";
import { normalizeAdapterResult, toProviderError } from "../utils.js";
import { isAbort, sleep, throwIfAborted } from "./failures.js";
import {
  cloneAdapterError,
  hookEvent,
  invokeAfterSendMiddleware,
  invokeHooks,
} from "./lifecycle.js";
import { recipientCount } from "./send-telemetry.js";

export const defaultDelay = (attempt: number) => Math.min(100 * 2 ** (attempt - 1), 2_000);

/**
 * Validates provider-reported counts against the recipients the SDK sent. `recipients` is
 * `undefined` when native fields replaced the message's recipients: the SDK then doesn't know how
 * many addresses the provider got, so the provider's counts only need to be well formed.
 */
export function acceptanceCounts(
  accepted: number | undefined,
  rejected: number | undefined,
  recipients: number | undefined,
  requireComplete: boolean,
) {
  const limit = recipients ?? Number.MAX_SAFE_INTEGER;

  const valid = (count: number | undefined) =>
    count === undefined || (Number.isSafeInteger(count) && count >= 0 && count <= limit);

  if (
    !valid(accepted) ||
    !valid(rejected) ||
    (recipients !== undefined &&
      accepted !== undefined &&
      rejected !== undefined &&
      (accepted + rejected > recipients || (requireComplete && accepted + rejected !== recipients)))
  ) {
    return { accepted: 0, rejected: 0, explicit: false };
  }

  return {
    accepted: accepted ?? 0,
    rejected: rejected ?? 0,
    explicit: accepted !== undefined || rejected !== undefined,
  };
}

export type AttemptPath = "single" | "personalized_native" | "personalized_expanded";

/**
 * Runs one adapter call, timing it for telemetry when telemetry is on. `native` is the entry the
 * adapter received; see `nativeAttemptFacts` for how it changes what the attempt reports.
 */
export type MeasureAttempt = <T extends EmailSendResult>(
  adapter: EmailAdapter,
  path: AttemptPath,
  recipients: number,
  invoke: () => T | PromiseLike<T>,
  native?: EmailNativeObject,
) => T | PromiseLike<T>;

// The raw passthroughs can replace any top-level request field, recipients included. Typed
// native options can't.
export const RECIPIENT_REPLACING_NATIVE_KEYS = ["body", "fields"] as const;

/**
 * What an attempt's native entry means for telemetry. `recipientsReplaced`: a raw passthrough may
 * send to recipients other than the message's. `validationOnly`: SendGrid's `sandboxMode` and
 * Mailgun's `testMode` make the provider validate the request without delivering it.
 */
export function nativeAttemptFacts(adapter: string, native: EmailNativeObject | undefined) {
  const rawOverride =
    native !== undefined && RECIPIENT_REPLACING_NATIVE_KEYS.some((key) => native[key] !== undefined);

  return {
    recipientsReplaced: rawOverride,
    // A raw override can switch the mode back off, so only the typed flag alone counts.
    validationOnly:
      !rawOverride &&
      ((adapter === "sendgrid" && native?.sandboxMode === true) ||
        (adapter === "mailgun" && native?.testMode === true)),
  };
}

/**
 * This adapter's own entry from the send's `native` map, snapshotted so an adapter or a retry
 * can't change what the caller, a later attempt, or another adapter sees.
 */
export function nativeEntryFor(
  native: EmailNativeSendOptions["native"],
  adapter: string,
): EmailNativeObject | undefined {
  if (!native || !Object.hasOwn(native, adapter)) return undefined;

  const entry = native[adapter];

  return entry === undefined ? undefined : snapshotNativeObject(entry);
}

export type AttemptInput = {
  adapter: EmailAdapter;
  message: EmailMessage;
  options?: EmailNativeSendOptions;
  retry?: EmailRetryConfig;
  hooks: readonly EmailHooks[];
  middleware: readonly EmailSendMiddleware[];
  measureAttempt: MeasureAttempt;
  path?: Exclude<AttemptPath, "personalized_native">;
};

export class AttemptFailure {
  constructor(
    readonly error: EmailSdkError,
    readonly attempt: number,
  ) {}
}

export async function attemptAdapter(input: AttemptInput): Promise<EmailSendResult> {
  const maxAttempts = input.retry?.maxAttempts ?? 1;
  const shouldRetry = input.retry?.shouldRetry ?? isRetryableEmailError;
  const delayFor = input.retry?.delay ?? defaultDelay;
  // Once any attempt may have reached the provider, no later rejection can prove the message
  // was never sent, so the final failure must not report not_sent.
  let earlierOutcomeUnknown = false;

  if (!isFunction(input.adapter.send)) {
    throw new EmailValidationError(`${input.adapter.name} adapter does not support send().`);
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(input.options?.signal);

    const freshEvent = () =>
      hookEvent(
        input.adapter.name,
        snapshotMessage(input.message),
        attempt,
        input.options?.metadata ? cloneMetadataRecord(input.options.metadata) : undefined,
      );

    const beforeSend = invokeHooks(input.hooks, "beforeSend", freshEvent);

    if (beforeSend) await beforeSend;

    let result: EmailSendResult;
    const native = nativeEntryFor(input.options?.native, input.adapter.name);

    try {
      const attemptMessage = snapshotMessage(input.message);

      const attemptMetadata = input.options?.metadata
        ? cloneMetadataRecord(input.options.metadata)
        : undefined;

      result = await input.measureAttempt(
        input.adapter,
        input.path ?? "single",
        recipientCount(input.message),
        async () =>
          normalizeAdapterResult(
            input.adapter.name,
            await input.adapter.send(attemptMessage, {
              adapter: input.adapter.name,
              operation: "send",
              attempt,
              signal: input.options?.signal,
              idempotencyKey: input.options?.idempotencyKey,
              metadata: attemptMetadata,
              native,
            }),
          ),
        native,
      );

      throwIfAborted(input.options?.signal);
    } catch (error) {
      if (isAbort(error, input.options?.signal)) throw new EmailAbortError(error);

      if (error instanceof EmailValidationError || error instanceof EmailMiddlewareError)
        throw error;
      const normalized = toProviderError(input.adapter.name, error);

      if (!(normalized instanceof EmailAdapterError)) throw normalized;
      const canRetry = attempt < maxAttempts && shouldRetry(normalized, attempt);

      if (!canRetry) {
        throw new AttemptFailure(
          earlierOutcomeUnknown ? withUnknownDelivery(normalized) : normalized,
          attempt,
        );
      }

      if (normalized.delivery === "unknown") earlierOutcomeUnknown = true;

      const delayMs = Math.max(0, delayFor(attempt, normalized));
      await invokeHooks(input.hooks, "onRetry", () => ({
        ...freshEvent(),
        error: cloneAdapterError(normalized),
        nextAttempt: attempt + 1,
        delayMs,
      }));
      await sleep(delayMs, input.options?.signal);
      continue;
    }

    const snapshotResult = (): EmailSendResult => {
      const copy: EmailSendResult = { ...result };

      if (result.accepted) copy.accepted = [...result.accepted];

      if (result.rejected) copy.rejected = [...result.rejected];

      return copy;
    };

    if (input.middleware.length > 0) {
      await invokeAfterSendMiddleware(input.middleware, () => ({
        ...freshEvent(),
        response: snapshotResult(),
      }));
    }

    if (input.hooks.length > 0) {
      await invokeHooks(input.hooks, "afterSend", () => ({
        ...freshEvent(),
        response: snapshotResult(),
      }));
    }

    return result;
  }

  throw new EmailAdapterError("Email retry loop exited unexpectedly.", {
    adapter: input.adapter.name,
    delivery: "unknown",
  });
}

/** Report a final failure as unknown when an earlier attempt may have sent the message. */
export function withUnknownDelivery(error: EmailAdapterError) {
  if (error.delivery === "unknown") return error;

  return new EmailAdapterError(error.message, {
    adapter: error.adapter,
    status: error.status,
    requestId: error.requestId,
    retryable: error.retryable,
    delivery: "unknown",
    acceptedCount: error.acceptedCount,
    rejectedCount: error.rejectedCount,
    cause: error,
  });
}
