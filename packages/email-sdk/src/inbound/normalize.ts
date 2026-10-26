import { type ParsedMimeMessage, decodeEncodedWords, parseAddress, parseAddressList, parseMimeMessage } from "./mime.js";
import { firstMessageId, messageIds, parseDate, payloadError, toBytes } from "./shared.js";
import type {
  InboundEmail,
  InboundEnvelope,
  InboundHeaders,
  InboundProvider,
  InboundRawPayload,
  InboundSecurity,
} from "./types.js";

/**
 * Fields every header-derived email shares, read from headers as sent. Address headers are
 * parsed before encoded words are decoded, so an encoded display name cannot inject an address.
 */
export function headerFields(headers: InboundHeaders) {
  const subject = headers.get("subject");

  return {
    messageId: firstMessageId(headers.get("message-id")),
    from: parseAddress(headers.get("from")),
    to: parseAddressList(headers.getAll("to").join(", ")),
    cc: parseAddressList(headers.getAll("cc").join(", ")),
    bcc: parseAddressList(headers.getAll("bcc").join(", ")),
    replyTo: parseAddressList(headers.getAll("reply-to").join(", ")),
    subject: subject === undefined ? undefined : decodeEncodedWords(subject),
    inReplyTo: firstMessageId(headers.get("in-reply-to")),
    references: messageIds(headers.getAll("references").join(" ")),
    date: parseDate(headers.get("date")),
  };
}

/**
 * Split on `;` outside quoted strings, after replacing comments with a space. Quoted strings keep
 * their quotes and escapes, so `authservId` can tell where one ends. A property value may be an
 * addr-spec such as `smtp.mailfrom=a@[x(y]`, whose domain literal holds data, not a comment.
 */
function resultClauses(value: string): string[] {
  const clauses: string[] = [];
  let current = "";
  let quoted = false;
  let comment = 0;
  let literal = false;
  // Only CFWS has followed an `@` so far, so a `[` here opens a domain literal.
  let afterAt = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;

    if (char === "\\" && (quoted || comment || literal)) {
      if (!comment) current += char + (value[index + 1] ?? "");

      index += 1;
      continue;
    }

    if (literal) {
      current += char;
      literal = char !== "]";
      continue;
    }

    if (!quoted && char === "(") comment += 1;
    else if (!quoted && char === ")" && comment) {
      comment -= 1;

      // A comment separates tokens, so `mx.trusted(x).test` is not `mx.trusted.test`.
      if (!comment) current += " ";
    } else if (!comment && char === "\"") {
      current += char;
      quoted = !quoted;
    } else if (!comment && !quoted && char === ";") {
      clauses.push(current.trim());
      current = "";
    } else if (!comment) {
      current += char;

      if (!quoted && char === "[" && afterAt) literal = true;
    }

    if (!quoted && !comment && char !== "(" && char !== ")" && char !== " " && char !== "\t") afterAt = char === "@";
  }

  clauses.push(current.trim());

  return clauses;
}

/**
 * The authserv-id that opens an `Authentication-Results` value: a token or a whole quoted string,
 * then an optional version. Anything else after it is malformed, so the header is not trusted.
 */
function authservId(clause: string): string | undefined {
  const match = /^(?:"((?:[^"\\]|\\.)*)"|([^\s"]+))(?:\s+\d+)?$/s.exec(clause);

  return match?.[2] ?? match?.[1]?.replace(/\\(.)/gs, "$1");
}

/**
 * Read SPF/DKIM/DMARC results from `Authentication-Results` headers (RFC 8601), using only
 * headers whose authserv-id is in `trusted`. Anyone can write this header into a message, so
 * results from other servers are ignored. The topmost trusted header wins.
 */
export function authenticationResults(headers: InboundHeaders, trusted: readonly string[]): InboundSecurity {
  const security: InboundSecurity = {};
  const allowed = new Set(trusted.map(id => id.toLowerCase()));

  if (!allowed.size) return security;

  for (const header of headers.getAll("authentication-results")) {
    const [first = "", ...clauses] = resultClauses(header.toLowerCase());
    const authserv = authservId(first);

    if (authserv === undefined || !allowed.has(authserv)) continue;

    for (const clause of clauses) {
      const match = /^([a-z-]+)(?:\/\d+)?\s*=\s*([a-z]+)/.exec(clause);
      const method = authMethod(match?.[1]);

      if (match && method && security[method] === undefined) security[method] = verdictFrom(match[2]!);
    }

    // Only the topmost trusted header counts; lower ones may be forged copies.
    break;
  }

  return security;
}

function authMethod(value: string | undefined): "spf" | "dkim" | "dmarc" | undefined {
  switch (value) {
    case "spf":
    case "dkim":
    case "dmarc":
      return value;
    default:
      return undefined;
  }
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
  /** Authserv-ids whose `Authentication-Results` headers are trusted. Defaults to none. */
  trustedAuthServIds?: readonly string[];
}

/** Build an `InboundEmail` from a raw RFC 5322 message. */
export function emailFromMime(options: MimeEmailOptions): InboundEmail {
  const bytes = toBytes(options.raw);
  let parsed: ParsedMimeMessage;

  try {
    parsed = parseMimeMessage(bytes);
  } catch (error) {
    throw payloadError(options.provider, `${options.provider} inbound message is not readable MIME.`, error instanceof Error ? error : undefined);
  }

  return {
    provider: options.provider,
    id: options.id,
    ...headerFields(parsed.rawHeaders),
    text: parsed.text,
    html: parsed.html,
    headers: parsed.headers,
    attachments: parsed.attachments,
    security: mergeSecurity(authenticationResults(parsed.rawHeaders, options.trustedAuthServIds ?? []), options.security),
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
