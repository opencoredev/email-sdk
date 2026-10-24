import { parseAddress, parseAddressList, parseMimeMessage } from "./mime.js";
import { firstMessageId, messageIds, parseDate, toBytes } from "./shared.js";
import type {
  InboundEmail,
  InboundEnvelope,
  InboundHeaders,
  InboundProvider,
  InboundRawPayload,
  InboundSecurity,
} from "./types.js";

/** Fields every header-derived email shares. Provider fields override them. */
export function headerFields(headers: InboundHeaders) {
  return {
    messageId: firstMessageId(headers.get("message-id")),
    from: parseAddress(headers.get("from")),
    to: parseAddressList(headers.getAll("to").join(", ")),
    cc: parseAddressList(headers.getAll("cc").join(", ")),
    bcc: parseAddressList(headers.getAll("bcc").join(", ")),
    replyTo: parseAddressList(headers.getAll("reply-to").join(", ")),
    subject: headers.get("subject"),
    inReplyTo: firstMessageId(headers.get("in-reply-to")),
    references: messageIds(headers.getAll("references").join(" ")),
    date: parseDate(headers.get("date")),
  };
}

/** Read SPF/DKIM/DMARC results from an `Authentication-Results` header. */
export function authenticationResults(headers: InboundHeaders): InboundSecurity {
  const security: InboundSecurity = {};
  const value = headers.getAll("authentication-results").join("; ").toLowerCase();

  for (const method of ["spf", "dkim", "dmarc"] as const) {
    const match = new RegExp(`\\b${method}=([a-z]+)`).exec(value);

    if (match) security[method] = verdictFrom(match[1]!);
  }

  return security;
}

function verdictFrom(value: string): InboundSecurity["spf"] {
  switch (value) {
    case "pass":
    case "fail":
    case "softfail":
    case "neutral":
    case "none":
    case "temperror":
    case "permerror":
      return value;
    default:
      return "unknown";
  }
}

export interface MimeEmailOptions {
  provider: InboundProvider;
  raw: string | Uint8Array;
  id?: string;
  envelope?: InboundEnvelope;
  security?: InboundSecurity;
  payload?: InboundRawPayload;
}

/** Build an `InboundEmail` from a raw RFC 5322 message. */
export function emailFromMime(options: MimeEmailOptions): InboundEmail {
  const bytes = toBytes(options.raw);
  const parsed = parseMimeMessage(bytes);

  return {
    provider: options.provider,
    id: options.id,
    ...headerFields(parsed.headers),
    text: parsed.text,
    html: parsed.html,
    headers: parsed.headers,
    attachments: parsed.attachments,
    security: mergeSecurity(authenticationResults(parsed.headers), options.security),
    envelope: options.envelope,
    raw: options.payload ?? { kind: "mime", bytes },
  };
}

/** Overlay provider verdicts on header-derived ones, ignoring missing provider values. */
export function mergeSecurity(base: InboundSecurity, overlay: InboundSecurity | undefined): InboundSecurity {
  const merged: InboundSecurity = { ...base };

  if (!overlay) return merged;

  if (overlay.spf !== undefined) merged.spf = overlay.spf;

  if (overlay.dkim !== undefined) merged.dkim = overlay.dkim;

  if (overlay.dmarc !== undefined) merged.dmarc = overlay.dmarc;

  if (overlay.spam !== undefined) merged.spam = overlay.spam;

  if (overlay.virus !== undefined) merged.virus = overlay.virus;

  if (overlay.spamScore !== undefined) merged.spamScore = overlay.spamScore;

  return merged;
}
