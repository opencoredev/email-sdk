import {
  EmailAbortError,
  EmailAdapterError,
  EmailMiddlewareError,
  EmailSdkError,
  EmailValidationError,
  isRetryableEmailError,
} from "../errors.js";
import { cloneMetadataRecord, isFunction } from "../internal/decode.js";
import { snapshotMessage } from "../internal/snapshot.js";
import type {
  EmailAdapter,
  EmailHooks,
  EmailMessage,
  EmailRetryConfig,
  EmailSendMiddleware,
  EmailSendOptions,
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

export function acceptanceCounts(
  accepted: number | undefined,
  rejected: number | undefined,
  recipients: number,
  requireComplete: boolean,
) {
  const valid = (count: number | undefined) =>
    count === undefined || (Number.isSafeInteger(count) && count >= 0 && count <= recipients);

  if (
    !valid(accepted) ||
    !valid(rejected) ||
    (accepted !== undefined &&
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

/** Runs one adapter call, timing it for telemetry when telemetry is on. */
export type MeasureAttempt = <T extends EmailSendResult>(
  adapter: EmailAdapter,
  path: AttemptPath,
  recipients: number,
  invoke: () => T | PromiseLike<T>,
) => T | PromiseLike<T>;

export type AttemptInput = {
  adapter: EmailAdapter;
  message: EmailMessage;
  options?: EmailSendOptions;
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
            }),
          ),
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

    if (input.middleware.length > 0) {
      await invokeAfterSendMiddleware(input.middleware, () => ({
        ...freshEvent(),
        response: { ...result },
      }));
    }

    if (input.hooks.length > 0) {
      await invokeHooks(input.hooks, "afterSend", () => ({
        ...freshEvent(),
        response: { ...result },
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
