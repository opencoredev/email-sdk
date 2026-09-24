import { EmailAbortError, EmailAdapterError, EmailSdkError } from "../errors.js";
import { toProviderError } from "../utils.js";
import { AttemptFailure } from "./attempts.js";

export function normalizeAdapterFailure(adapter: string, cause: unknown): EmailAdapterError {
  if (cause instanceof AttemptFailure) return normalizeAdapterFailure(adapter, cause.error);

  if (cause instanceof EmailAdapterError) return cause;
  const normalized = toProviderError(adapter, cause);

  return normalized instanceof EmailAdapterError
    ? normalized
    : new EmailAdapterError(normalized.message, {
        adapter,
        retryable: normalized.retryable,
        delivery: "unknown",
        cause: normalized,
      });
}

export function failureAttempt(cause: unknown) {
  return cause instanceof AttemptFailure ? cause.attempt : 1;
}

export function normalizeOwnedError(cause: unknown): EmailSdkError {
  if (cause instanceof EmailSdkError) return cause;

  return new EmailAdapterError(cause instanceof Error ? cause.message : "Email sending failed.", {
    adapter: "unknown",
    delivery: "unknown",
    cause,
  });
}

export function throwIfAborted(signal: AbortSignal | undefined) {
  if (signal?.aborted) throw new EmailAbortError(signal.reason);
}

export function isAbort(cause: unknown, signal: AbortSignal | undefined) {
  return signal?.aborted || (cause instanceof Error && cause.name === "AbortError");
}

export function sleep(delayMs: number, signal: AbortSignal | undefined) {
  if (delayMs <= 0) {
    throwIfAborted(signal);

    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(done, delayMs);

    const onAbort = () => {
      clearTimeout(timeout);
      signal?.removeEventListener("abort", onAbort);
      reject(new EmailAbortError(signal?.reason));
    };

    function done() {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}
