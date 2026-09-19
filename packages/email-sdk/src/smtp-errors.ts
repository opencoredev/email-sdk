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

const CERTIFICATE_ERROR_CODE_PATTERN =
  /(?:CERT_HAS_EXPIRED|CERT_NOT_YET_VALID|CERT_REVOKED|CERT_UNTRUSTED|DEPTH_ZERO_SELF_SIGNED_CERT|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_GET_ISSUER_CERT(?:_LOCALLY)?|UNABLE_TO_VERIFY_LEAF_SIGNATURE|ERR_TLS_CERT_ALTNAME_INVALID|INVALID_CA|CERT_SIGNATURE_FAILURE|ERR_SSL_(?:CA_KEY_TOO_SMALL|CERTIFICATE_VERIFY_FAILED)|ERR_TLS_CERTIFICATE_REQUIRED)/i;

const CERTIFICATE_ERROR_MESSAGE_PATTERN =
  /(?:certificate|cert|issuer|ca|tls).*(?:expired|revoked|not yet valid|self[- ]signed|unable to verify|unable to get issuer|unknown ca|invalid ca|signature failure|verify failed|altname|key (?:too small|too weak)|unsupported|untrusted|bad certificate)|(?:expired|revoked|not yet valid|self[- ]signed|unable to verify|unable to get issuer|unknown ca|invalid ca|signature failure|verify failed|altname|key (?:too small|too weak)|unsupported|untrusted|bad certificate).*(?:certificate|cert|issuer|\bca\b|tls)/i;

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
  const codeText = typeof code === "string" ? code : "";
  const isTlsError = codeText === "ESOCKET" || codeText === "ETLS";
  const hasCertificateCode = CERTIFICATE_ERROR_CODE_PATTERN.test(codeText);
  const hasCertificateMessage =
    typeof message === "string" && CERTIFICATE_ERROR_MESSAGE_PATTERN.test(message);

  return hasCertificateCode || (isTlsError && hasCertificateMessage);
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
