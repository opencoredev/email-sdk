import type { ErrorCode } from "nodemailer";

const RETRYABLE_NODEMAILER_CODES: ReadonlySet<string> = new Set([
  "ECONNECTION",
  "ETIMEDOUT",
  "ESOCKET",
  "EDNS",
  "ETLS",
  "EMAXLIMIT",
] satisfies readonly ErrorCode[]);

const NOT_SENT_NODEMAILER_CODES: ReadonlySet<string> = new Set([
  "EENVELOPE",
  "EMESSAGE",
  "EAUTH",
  "ENOAUTH",
  "EOAUTH2",
  "EDNS",
  "ECONFIG",
  "EPROXY",
  "EREQUIRETLS",
  "ETLS",
] satisfies readonly ErrorCode[]);

const CERTIFICATE_ERROR_PATTERN =
  /(?:certificate|tls).*(?:expired|not yet valid|self[- ]signed|unable to verify|local issuer|altname)|(?:expired|not yet valid|self[- ]signed|unable to verify|local issuer|altname).*(?:certificate|tls)|(?:CERT_HAS_EXPIRED|DEPTH_ZERO_SELF_SIGNED_CERT|UNABLE_TO_VERIFY_LEAF_SIGNATURE|ERR_TLS_CERT_ALTNAME_INVALID)/i;

function smtpErrorFields(error: unknown) {
  if (!error || typeof error !== "object") return {};
  return error as { responseCode?: unknown; code?: unknown; message?: unknown };
}

function smtpReplyClass(responseCode: unknown) {
  if (typeof responseCode !== "number") return undefined;
  if (responseCode >= 400 && responseCode < 500) return "transient";
  if (responseCode >= 500 && responseCode < 600) return "permanent";
  return undefined;
}

function isCertificateError(code: unknown, message: unknown) {
  return (
    (code === "ESOCKET" || code === "ETLS") &&
    typeof message === "string" &&
    CERTIFICATE_ERROR_PATTERN.test(message)
  );
}

export function isRetryableSmtpError(error: unknown) {
  const { responseCode, code, message } = smtpErrorFields(error);
  const replyClass = smtpReplyClass(responseCode);
  if (replyClass) return replyClass === "transient";
  if (typeof code !== "string") return false;
  if (isCertificateError(code, message)) return false;
  return RETRYABLE_NODEMAILER_CODES.has(code);
}

export function smtpDeliveryState(error: unknown) {
  const { responseCode, code, message } = smtpErrorFields(error);
  if (smtpReplyClass(responseCode)) return "not_sent" as const;
  if (isCertificateError(code, message)) return "not_sent" as const;
  return typeof code === "string" && NOT_SENT_NODEMAILER_CODES.has(code)
    ? ("not_sent" as const)
    : ("unknown" as const);
}
