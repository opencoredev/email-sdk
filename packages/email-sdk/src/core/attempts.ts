import {
  EmailAbortError,
  EmailAdapterError,
  EmailMiddlewareError,
  EmailSdkError,
  EmailValidationError,
  isRetryableEmailError,
} from "../errors.js";
import type {
  EmailAdapter,
  EmailAfterSendEvent,
  EmailHooks,
  EmailMessage,
  EmailRetryConfig,
  EmailSendMiddleware,
  EmailSendOptions,
  EmailSendResult,
} from "../types.js";
import { normalizeAdapterResult, toProviderError } from "../utils.js";
import { isAbort, sleep, throwIfAborted } from "./failures.js";
import { hookEvent, invokeAfterSendMiddleware, invokeHooks } from "./lifecycle.js";
import { messageFacts } from "./send-telemetry.js";

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

export type MeasureAttempt = <T extends EmailSendResult>(
  adapter: EmailAdapter,
  path: "single" | "personalized_native" | "personalized_expanded",
  recipients: number,
  invoke: () => T | PromiseLike<T>,
) => Promise<T>;

export type AttemptInput = {
  adapter: EmailAdapter;
  message: EmailMessage;
  options?: EmailSendOptions;
  retry?: EmailRetryConfig;
  hooks: EmailHooks[];
  middleware: EmailSendMiddleware[];
  measureAttempt: MeasureAttempt;
  path?: "single" | "personalized_expanded";
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

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfAborted(input.options?.signal);
    const event = hookEvent(input.adapter.name, input.message, attempt, input.options?.metadata);
    await invokeHooks(input.hooks, "beforeSend", event);

    let result: EmailSendResult;

    try {
      const adapterResult = await input.measureAttempt(
        input.adapter,
        input.path ?? "single",
        messageFacts(input.message).recipients,
        () =>
          input.adapter.send(input.message, {
            adapter: input.adapter.name,
            operation: "send",
            attempt,
            signal: input.options?.signal,
            idempotencyKey: input.options?.idempotencyKey,
            metadata: input.options?.metadata,
          }),
      );

      throwIfAborted(input.options?.signal);
      result = normalizeAdapterResult(input.adapter.name, adapterResult);
    } catch (error) {
      if (isAbort(error, input.options?.signal)) throw new EmailAbortError(error);

      if (error instanceof EmailValidationError || error instanceof EmailMiddlewareError)
        throw error;
      const normalized = toProviderError(input.adapter.name, error);

      if (!(normalized instanceof EmailAdapterError)) throw normalized;
      const canRetry = attempt < maxAttempts && shouldRetry(normalized, attempt);

      if (!canRetry) throw new AttemptFailure(normalized, attempt);

      const delayMs = Math.max(0, delayFor(attempt, normalized));
      await invokeHooks(input.hooks, "onRetry", {
        ...event,
        error: normalized,
        nextAttempt: attempt + 1,
        delayMs,
      });
      await sleep(delayMs, input.options?.signal);
      continue;
    }

    const afterEvent: EmailAfterSendEvent = { ...event, response: result };
    await invokeAfterSendMiddleware(input.middleware, afterEvent);
    await invokeHooks(input.hooks, "afterSend", afterEvent);

    return result;
  }

  throw new EmailAdapterError("Email retry loop exited unexpectedly.", {
    adapter: input.adapter.name,
    delivery: "unknown",
  });
}
