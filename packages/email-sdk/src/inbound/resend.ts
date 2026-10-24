import { type JsonObject, type JsonValue, isJsonString } from "../internal/decode.js";
import { parseAddress, parseAddressList } from "./mime.js";
import {
  type InboundFetchOptions,
  concatBytes,
  decodeBase64Strict,
  fetchBytes,
  fetchJson,
  firstMessageId,
  hmac,
  jsonList,
  jsonNumber,
  jsonObject,
  jsonText,
  messageIds,
  parseDate,
  parseJsonObjectBody,
  payloadError,
  readHeader,
  rejected,
  remoteAttachment,
  signingSecrets,
  timestampFresh,
  timingSafeEqual,
  toBytes,
  utf8Bytes,
  verdict,
  verified,
} from "./shared.js";
import {
  type InboundAddress,
  type InboundAttachment,
  type InboundEmail,
  InboundHeaders,
  type InboundRequestPayload,
  type InboundSignatureOptions,
  type InboundVerification,
} from "./types.js";

const provider = "resend";

export interface ResendInboundApiOptions extends InboundFetchOptions {
  apiKey: string;
  baseUrl?: string;
}

/**
 * Verify a Resend (Svix) webhook signature over `svix-id.svix-timestamp.body`.
 * The secret is the `whsec_` signing secret from the webhook settings.
 */
export async function verifyResendInbound(
  payload: InboundRequestPayload,
  options: InboundSignatureOptions,
): Promise<InboundVerification> {
  const secrets = signingSecrets(options.secret);

  if (!secrets.length) return rejected("secret_missing");

  const id = readHeader(payload.headers, "svix-id");
  const timestamp = readHeader(payload.headers, "svix-timestamp");
  const header = readHeader(payload.headers, "svix-signature");

  if (!id || !timestamp || !header) return rejected("signature_missing");

  if (!timestampFresh(timestamp, options)) return rejected("timestamp_expired");

  const candidates: Uint8Array[] = [];

  for (const entry of header.split(" ")) {
    const match = /^v1,(.+)$/.exec(entry);

    if (!match) continue;

    try {
      candidates.push(decodeBase64Strict(match[1]!));
    } catch {
      return rejected("signature_invalid");
    }
  }

  if (!candidates.length) return rejected("signature_missing");

  const content = concatBytes(utf8Bytes(`${id}.${timestamp}.`), toBytes(payload.body));

  for (const secret of secrets) {
    let key: Uint8Array<ArrayBuffer>;

    try {
      key = decodeBase64Strict(secret.replace(/^whsec_/, ""));
    } catch {
      return rejected("secret_missing");
    }

    const expected = await hmac("SHA-256", key, content);

    if (candidates.some(candidate => timingSafeEqual(candidate, expected))) return verified;
  }

  return rejected("signature_invalid");
}

function addresses(value: JsonValue | undefined): InboundAddress[] {
  return jsonList(value).flatMap(entry => parseAddressList(jsonText(entry)));
}

function headerRecord(value: JsonValue | undefined): InboundHeaders {
  const record = jsonObject(value);

  if (!record) return new InboundHeaders();

  return new InboundHeaders(Object.entries(record).flatMap(([name, entry]) => {
    if (Array.isArray(entry)) return entry.flatMap(item => isJsonString(item) ? [{ name, value: item }] : []);

    return isJsonString(entry) ? [{ name, value: entry }] : [];
  }));
}

function attachments(
  list: JsonValue | undefined,
  download?: (id: string) => Promise<Uint8Array>,
): InboundAttachment[] {
  return jsonList(list).flatMap(entry => {
    const item = jsonObject(entry);
    const id = jsonText(item?.id);

    if (!item) return [];

    const disposition = jsonText(item.content_disposition);
    const url = jsonText(item.download_url);

    return [remoteAttachment({
      filename: jsonText(item.filename),
      contentType: jsonText(item.content_type) ?? "application/octet-stream",
      size: jsonNumber(item.size),
      contentId: jsonText(item.content_id),
      disposition: disposition === "inline" ? "inline" : "attachment",
      url,
    }, async () => {
      if (download && id) return download(id);

      throw payloadError(provider, "Resend attachment content needs fetchResendInboundEmail() with an API key.");
    })];
  });
}

function emailFromJson(data: JsonObject, root: JsonValue, download?: (id: string) => Promise<Uint8Array>): InboundEmail {
  const headers = headerRecord(data.headers);
  const authentication = jsonObject(data.authentication);

  return {
    provider,
    id: jsonText(data.email_id) ?? jsonText(data.id),
    messageId: firstMessageId(jsonText(data.message_id) ?? headers.get("message-id")),
    from: parseAddress(headers.get("from") ?? jsonText(data.from)),
    to: addresses(data.to),
    cc: addresses(data.cc),
    bcc: addresses(data.bcc),
    replyTo: addresses(data.reply_to),
    subject: jsonText(data.subject),
    text: jsonText(data.text),
    html: jsonText(data.html),
    headers,
    attachments: attachments(data.attachments, download),
    inReplyTo: firstMessageId(headers.get("in-reply-to")),
    references: messageIds(headers.get("references")),
    date: parseDate(headers.get("date") ?? jsonText(data.created_at)),
    security: {
      spf: verdict(jsonText(authentication?.spf)),
      dkim: verdict(jsonText(authentication?.dkim)),
      dmarc: verdict(jsonText(authentication?.dmarc)),
    },
    envelope: { to: jsonList(data.received_for).flatMap(entry => jsonText(entry) ?? []) },
    raw: { kind: "json", value: root },
  };
}

/**
 * Parse a Resend `email.received` webhook. The webhook carries metadata only; call
 * `fetchResendInboundEmail` (or pass `api` to `handleInbound`) for bodies and attachments.
 */
export function parseResendInbound(payload: InboundRequestPayload): InboundEmail {
  const root = parseJsonObjectBody(provider, payload.body);

  if (jsonText(root.type) !== "email.received") {
    throw payloadError(provider, `Resend webhook type ${jsonText(root.type) ?? "(missing)"} is not email.received.`);
  }

  const data = jsonObject(root.data);

  if (!data) throw payloadError(provider, "Resend email.received webhook has no data object.");

  return emailFromJson(data, root);
}

/** Fetch a received email, with bodies, headers, and downloadable attachments. */
export async function fetchResendInboundEmail(id: string, options: ResendInboundApiOptions): Promise<InboundEmail> {
  const baseUrl = options.baseUrl ?? "https://api.resend.com";
  const headers = { Authorization: `Bearer ${options.apiKey}`, Accept: "application/json" };
  const init = { headers, fetch: options.fetch, signal: options.signal };
  const encoded = encodeURIComponent(id);
  const email = await fetchJson(provider, `${baseUrl}/emails/receiving/${encoded}`, init);
  const list = await fetchJson(provider, `${baseUrl}/emails/receiving/${encoded}/attachments`, init);
  const listed = jsonList(list.data);

  const urls = new Map(listed.flatMap(entry => {
    const item = jsonObject(entry);
    const attachmentId = jsonText(item?.id);
    const url = jsonText(item?.download_url);

    return attachmentId && url ? [[attachmentId, url] as const] : [];
  }));

  const download = async (attachmentId: string) => {
    const url = urls.get(attachmentId);

    if (!url) throw payloadError(provider, `Resend attachment ${attachmentId} has no download URL.`);

    return fetchBytes(provider, url, { fetch: options.fetch, signal: options.signal });
  };

  return emailFromJson({ ...email, attachments: listed.length ? listed : email.attachments ?? [] }, email, download);
}
