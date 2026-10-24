import { parseJson } from "../internal/decode.js";
import { decodeCharset, parseAddress, parseAddressList, parseMimeHeaders, parseMultipartFormData } from "./mime.js";
import { emailFromMime, headerFields, mergeSecurity } from "./normalize.js";
import {
  decodeBase64Strict,
  inlineAttachment,
  jsonList,
  jsonNumber,
  jsonObject,
  jsonText,
  payloadError,
  readHeader,
  rejected,
  timestampFresh,
  toBytes,
  utf8Bytes,
  verdict,
  verified,
} from "./shared.js";
import type {
  InboundAttachment,
  InboundClockOptions,
  InboundEmail,
  InboundEnvelope,
  InboundRequestPayload,
  InboundSecurity,
  InboundVerification,
} from "./types.js";

const provider = "sendgrid";

export interface SendGridInboundVerificationOptions extends InboundClockOptions {
  /** The base64 ECDSA public key from the Inbound Parse security policy (`signature.public_key`). */
  publicKey: string | readonly string[];
}

/** Convert a DER ECDSA signature to the raw `r || s` form WebCrypto verifies. */
function derToRaw(der: Uint8Array, size: number): Uint8Array<ArrayBuffer> | undefined {
  if (der[0] !== 0x30) return undefined;

  let offset = der[1]! & 0x80 ? 2 + (der[1]! & 0x7f) : 2;
  const raw = new Uint8Array(size * 2);

  for (let index = 0; index < 2; index += 1) {
    if (der[offset] !== 0x02) return undefined;

    const length = der[offset + 1]!;
    let value = der.subarray(offset + 2, offset + 2 + length);

    while (value.length > size && value[0] === 0) value = value.subarray(1);

    if (value.length > size) return undefined;

    raw.set(value, index * size + size - value.length);
    offset += 2 + length;
  }

  return raw;
}

/**
 * Verify a signed Inbound Parse request: ECDSA P-256 / SHA-256 over
 * `X-Twilio-Email-Event-Webhook-Timestamp` followed by the raw body.
 */
export async function verifySendGridInbound(
  payload: InboundRequestPayload,
  options: SendGridInboundVerificationOptions,
): Promise<InboundVerification> {
  const keys = (Array.isArray(options.publicKey) ? options.publicKey : [options.publicKey]).filter(Boolean);

  if (!keys.length) return rejected("secret_missing");

  const signature = readHeader(payload.headers, "x-twilio-email-event-webhook-signature");
  const timestamp = readHeader(payload.headers, "x-twilio-email-event-webhook-timestamp");

  if (!signature || !timestamp) return rejected("signature_missing");

  if (!timestampFresh(timestamp, options)) return rejected("timestamp_expired");

  let raw: Uint8Array<ArrayBuffer> | undefined;

  try {
    raw = derToRaw(decodeBase64Strict(signature), 32);
  } catch {
    return rejected("signature_invalid");
  }

  if (!raw) return rejected("signature_invalid");

  const body = toBytes(payload.body);
  const signed = new Uint8Array(timestamp.length + body.length);
  signed.set(utf8Bytes(timestamp));
  signed.set(body, timestamp.length);

  for (const key of keys) {
    try {
      const cryptoKey = await crypto.subtle.importKey(
        "spki",
        decodeBase64Strict(key.replace(/-----[^-]+-----|\s/g, "")),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );

      if (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, raw, signed)) return verified;
    } catch {
      return rejected("secret_missing");
    }
  }

  return rejected("signature_invalid");
}

function sendGridSecurity(fields: ReadonlyMap<string, string>): InboundSecurity {
  const dkim = fields.get("dkim")?.toLowerCase();
  const score = jsonNumber(fields.get("spam_score"));

  return {
    spf: verdict(fields.get("SPF")),
    dkim: dkim === undefined ? undefined : dkim.includes(": pass") ? "pass" : dkim.includes(": fail") ? "fail" : verdict(dkim.replace(/[{}]/g, "")),
    spamScore: score,
  };
}

function envelopeFrom(value: string | undefined): InboundEnvelope | undefined {
  const parsed = jsonObject(value === undefined ? undefined : parseJson(value));

  if (!parsed) return undefined;

  return { from: jsonText(parsed.from), to: jsonList(parsed.to).flatMap(entry => jsonText(entry) ?? []) };
}

/**
 * Parse a SendGrid Inbound Parse post, in default (parsed) or "Send Raw" mode. Field text is
 * decoded with the charsets SendGrid declares in `charsets`.
 */
export function parseSendGridInbound(payload: InboundRequestPayload): InboundEmail {
  const contentType = readHeader(payload.headers, "content-type");

  if (!contentType?.toLowerCase().startsWith("multipart/form-data")) {
    throw payloadError(provider, "SendGrid Inbound Parse posts must be multipart/form-data.");
  }

  const parts = parseMultipartFormData(payload.body, contentType);

  if (!parts.length) throw payloadError(provider, "SendGrid Inbound Parse body has no form fields.");

  const charsets = jsonObject(parseJson(decodeCharset(parts.find(part => part.name === "charsets")?.bytes ?? new Uint8Array(), "utf-8")) ?? null);
  const fields = new Map<string, string>();
  const formFields = new Map<string, string[]>();
  const files: InboundAttachment[] = [];
  const info = new Map<string, { contentId?: string; filename?: string; type?: string }>();

  for (const part of parts) {
    if (part.filename !== undefined) continue;

    const value = decodeCharset(part.bytes, jsonText(charsets?.[part.name]) ?? "utf-8");
    fields.set(part.name, value);
    formFields.set(part.name, [...formFields.get(part.name) ?? [], value]);
  }

  const attachmentInfo = jsonObject(parseJson(fields.get("attachment-info") ?? "") ?? null);

  for (const [key, entry] of Object.entries(attachmentInfo ?? {})) {
    const item = jsonObject(entry);

    info.set(key, {
      contentId: jsonText(item?.["content-id"]),
      filename: jsonText(item?.filename) ?? jsonText(item?.name),
      type: jsonText(item?.type),
    });
  }

  for (const part of parts) {
    if (part.filename === undefined) continue;

    const details = info.get(part.name);
    const contentId = details?.contentId?.replace(/^<|>$/g, "");

    files.push(inlineAttachment({
      filename: details?.filename ?? (part.filename || undefined),
      contentType: details?.type ?? part.contentType ?? "application/octet-stream",
      contentId,
      disposition: contentId ? "inline" : "attachment",
      content: part.bytes,
    }));
  }

  const raw = { kind: "form" as const, fields: formFields };
  const envelope = envelopeFrom(fields.get("envelope"));
  const security = sendGridSecurity(fields);
  const mime = parts.find(part => part.name === "email");

  if (mime) {
    const email = emailFromMime({ provider, raw: mime.bytes, envelope, payload: raw });
    email.security = mergeSecurity(email.security, security);

    return email;
  }

  const { headers, rawHeaders } = parseMimeHeaders(fields.get("headers") ?? "");
  const fromHeaders = headerFields(rawHeaders);

  return {
    provider,
    ...fromHeaders,
    id: fromHeaders.messageId,
    from: parseAddress(fields.get("from")) ?? fromHeaders.from,
    to: fields.has("to") ? parseAddressList(fields.get("to")) : fromHeaders.to,
    cc: fields.has("cc") ? parseAddressList(fields.get("cc")) : fromHeaders.cc,
    subject: fields.get("subject") ?? fromHeaders.subject,
    text: fields.get("text"),
    html: fields.get("html"),
    headers,
    attachments: files,
    security,
    envelope,
    raw,
  };
}
