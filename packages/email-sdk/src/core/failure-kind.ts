import {
  EmailAbortError,
  EmailAdapterError,
  EmailAllRecipientsFailedError,
  EmailMiddlewareError,
  EmailRouteError,
  EmailSdkError,
  EmailValidationError,
} from "../errors.js";
import { causeNumber, causeString, isObjectLike } from "../internal/decode.js";
import { normalizeAdapterFailure } from "./failures.js";

/**
 * Why an adapter attempt failed, as far as telemetry is concerned.
 *
 * Only `unexpected` points at a defect in SDK code. Every other kind is the
 * provider, the network, or the caller saying no, which is counted on send
 * events but never reported to error tracking.
 */
export type FailureKind =
  | "auth"
  | "rate_limited"
  | "rejected"
  | "provider_error"
  | "network"
  | "caller"
  | "unexpected";

const MAX_CAUSE_DEPTH = 6;

// Errors JavaScript raises when code is wrong, rather than when the world is.
// SyntaxError is missing on purpose: at runtime it only comes from parsing,
// and the SDK only parses provider replies, so it means a malformed answer.
const PROGRAMMING_ERROR_NAMES = new Set([
  "TypeError",
  "RangeError",
  "ReferenceError",
  "EvalError",
  "URIError",
]);

// `new Headers()` and `fetch()` reject header names and values the caller
// configured (an API key with a newline, a custom header with a space). Node
// says 'is an invalid header name' or 'Cannot convert argument to a
// ByteString'; Bun says 'Invalid header name' or 'Header ... has invalid value'.
const INVALID_HEADER_PATTERN =
  /invalid header (?:name|value)|^Header .* has invalid value|Cannot convert argument to a ByteString/i;

// Node errno codes, undici codes, Bun fetch codes, Nodemailer connection codes,
// and TLS certificate failures all mean the request never reached a provider
// that could answer it.
const NETWORK_CODE_PATTERN =
  /^(?:E(?:CONN\w*|HOSTUNREACH|NETUNREACH|NETDOWN|PIPE|AI_\w+|TIMEDOUT|NOTFOUND|ADDRNOTAVAIL|PROTO|SOCKET|DNS|TLS|PROXY|REQUIRETLS)|UND_ERR_\w+|ERR_(?:TLS|SSL|SOCKET)_\w+|CERT_\w+|UNABLE_TO_\w+|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|ConnectionRefused|ConnectionClosed|FailedToOpenSocket|Timeout)$/;

// Runtime fetch failures that carry no code: Node ("fetch failed"), Bun
// ("Unable to connect"), Workers ("Network connection lost"), and browsers.
const NETWORK_MESSAGE_PATTERN =
  /fetch failed|failed to fetch|unable to connect|network ?(?:connection|error)|socket hang up|timed out|connection (?:reset|lost|closed|refused)/i;

const AUTH_CODES = new Set(["EAUTH", "ENOAUTH", "EOAUTH2"]);

// SMTP replies that mean the credentials were refused (RFC 4954).
const SMTP_AUTH_REPLIES = new Set([530, 534, 535, 538]);

function statusKind(status: number): FailureKind {
  if (status === 401 || status === 403) return "auth";

  if (status === 429) return "rate_limited";

  if (status >= 500) return "provider_error";

  // Any other answer, including a 2xx the adapter could not use, came from the
  // provider and is the provider's call.
  return "rejected";
}

/** Error, cause, cause's cause, … up to a fixed depth, skipping cycles. */
function causeChain(error: EmailAdapterError): unknown[] {
  const chain: unknown[] = [];
  let current: unknown = error;

  while (isObjectLike(current) && chain.length < MAX_CAUSE_DEPTH && !chain.includes(current)) {
    chain.push(current);
    current = current instanceof Error ? current.cause : undefined;
  }

  return chain;
}

/**
 * Classifies one failed adapter attempt. Never throws: the error came from code
 * the SDK may not own, and a throwing getter on it must not turn telemetry
 * into a different send failure.
 */
export function classifyAdapterFailure(error: EmailAdapterError): FailureKind {
  try {
    return classify(error);
  } catch {
    return "rejected";
  }
}

/** classifyAdapterFailure for whatever an adapter attempt threw. Never throws. */
export function classifyAttemptFailure(adapter: string, cause: unknown): FailureKind {
  try {
    return classify(normalizeAdapterFailure(adapter, cause));
  } catch {
    return "rejected";
  }
}

function classify(error: EmailAdapterError): FailureKind {
  const chain = causeChain(error);

  if (
    chain.some(
      (link) =>
        link instanceof EmailMiddlewareError ||
        link instanceof EmailValidationError ||
        link instanceof EmailAbortError,
    )
  ) {
    return "caller";
  }

  if (error.status !== undefined) return statusKind(error.status);

  for (const link of chain) {
    const code = causeString(link, "code");
    const reply = causeNumber(link, "responseCode");

    if (
      (code !== undefined && AUTH_CODES.has(code)) ||
      (reply !== undefined && SMTP_AUTH_REPLIES.has(reply))
    ) {
      return "auth";
    }

    if (code === "EMAXLIMIT") return "rate_limited";

    if (reply !== undefined && reply >= 400) return "rejected";

    if (code !== undefined && NETWORK_CODE_PATTERN.test(code)) return "network";

    if (link instanceof Error && (link.name === "AbortError" || link.name === "TimeoutError")) {
      return "network";
    }

    if (
      link instanceof Error &&
      !(link instanceof EmailSdkError) &&
      NETWORK_MESSAGE_PATTERN.test(link.message)
    ) {
      return "network";
    }
  }

  // The innermost thrown value decides between "code is wrong" and "the
  // adapter turned a provider answer into an error on purpose".
  const root = chain.at(-1);

  if (root instanceof EmailSdkError || !(root instanceof Error)) return "rejected";

  if (root.name === "SyntaxError") return "provider_error";

  if (root.name === "TypeError" && INVALID_HEADER_PATTERN.test(root.message)) return "caller";

  return PROGRAMMING_ERROR_NAMES.has(root.name) ? "unexpected" : "rejected";
}

/** The adapter failures behind a failed send, in the order they happened. */
export function sendFailures(error: EmailSdkError): readonly EmailAdapterError[] {
  if (error instanceof EmailRouteError || error instanceof EmailAllRecipientsFailedError) {
    return error.failures;
  }

  return error instanceof EmailAdapterError ? [error] : [];
}

/** The failure kind to record on an `email sent` event for a failed send. */
export function classifySendFailure(error: EmailSdkError): FailureKind {
  const last = sendFailures(error).at(-1);

  return last ? classifyAdapterFailure(last) : "caller";
}

/**
 * The first adapter failure that points at an SDK defect, if any. Failures from
 * caller code are never defects of the SDK, so `isSdkOwned` decides which
 * failures came from SDK code.
 */
export function findSdkDefect(
  error: EmailSdkError,
  isSdkOwned: (failure: EmailAdapterError) => boolean,
): EmailAdapterError | undefined {
  return sendFailures(error).find(
    (failure) => isSdkOwned(failure) && classifyAdapterFailure(failure) === "unexpected",
  );
}
