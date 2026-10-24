import type { JsonObject } from "../internal/decode.js";
import { parseAddress, parseAddressList } from "./mime.js";
import { emailFromMime, headerFields } from "./normalize.js";
import {
  type InboundFetchOptions,
  fetchBytes,
  fetchJson,
  firstMessageId,
  jsonList,
  jsonNumber,
  jsonObject,
  jsonText,
  messageIds,
  parseDate,
  readHeader,
  remoteAttachment,
  toBytes,
  verifyHmac,
} from "./shared.js";
import {
  type InboundEmail,
  InboundHeaders,
  type InboundRequestPayload,
  type InboundTokenOptions,
  type InboundVerification,
} from "./types.js";

const provider = "mailtrap";

export interface MailtrapInboundApiOptions extends InboundFetchOptions {
  apiToken: string;
  baseUrl?: string;
}

/** Verify `mailtrap-signature`: hex HMAC-SHA256 of the raw body with the webhook's signing secret. */
export function verifyMailtrapInbound(
  payload: InboundRequestPayload,
  options: InboundTokenOptions,
): Promise<InboundVerification> {
  return verifyHmac("SHA-256", readHeader(payload.headers, "mailtrap-signature"), "hex", options.secret, toBytes(payload.body));
}

function emailFromDetails(details: JsonObject, options: MailtrapInboundApiOptions): InboundEmail {
  const headers = new InboundHeaders(Object.entries(jsonObject(details.headers) ?? {}).flatMap(([name, value]) => {
    const text = jsonText(value);

    return text === undefined ? [] : [{ name, value: text }];
  }));

  const thread = headerFields(headers);
  const references = jsonList(details.references).flatMap(entry => messageIds(jsonText(entry)));
  const list = (key: string) => jsonList(details[key]).flatMap(entry => parseAddressList(jsonText(entry)));

  return {
    provider,
    id: jsonText(details.id),
    messageId: firstMessageId(jsonText(details.rfc_message_id)) ?? jsonText(details.rfc_message_id) ?? thread.messageId,
    from: parseAddress(jsonText(details.from)),
    to: list("to"),
    cc: list("cc"),
    bcc: list("bcc"),
    replyTo: parseAddressList(jsonText(details.reply_to)),
    subject: jsonText(details.subject),
    text: jsonText(details.text_body),
    html: jsonText(details.html_body),
    headers,
    attachments: jsonList(details.attachments).flatMap(entry => {
      const item = jsonObject(entry);
      const url = jsonText(item?.download_url);

      if (!item) return [];

      return [remoteAttachment({
        filename: jsonText(item.filename),
        contentType: jsonText(item.content_type) ?? "application/octet-stream",
        size: jsonNumber(item.size),
        contentId: jsonText(item.content_id)?.replace(/^<|>$/g, ""),
        disposition: jsonText(item.content_disposition) === "inline" ? "inline" : "attachment",
        url,
      }, () => url
        ? fetchBytes(provider, url, { fetch: options.fetch, signal: options.signal })
        : Promise.reject(new Error("Mailtrap attachment has no download URL.")))];
    }),
    inReplyTo: firstMessageId(jsonText(details.in_reply_to)) ?? thread.inReplyTo,
    references: references.length ? references : thread.references,
    date: parseDate(jsonText(details.received_at)),
    security: {},
    raw: { kind: "json", value: details },
  };
}

/**
 * Fetch a message from a Mailtrap inbound inbox. The raw `.eml` is downloaded and parsed when
 * Mailtrap provides it, so headers and attachments keep full fidelity.
 */
export async function fetchMailtrapInboundEmail(
  inboxId: string | number,
  messageId: string,
  options: MailtrapInboundApiOptions,
): Promise<InboundEmail> {
  const baseUrl = options.baseUrl ?? "https://mailtrap.io";
  const init = { headers: { "Api-Token": options.apiToken, Accept: "application/json" }, fetch: options.fetch, signal: options.signal };
  const details = await fetchJson(provider, `${baseUrl}/api/inbound/inboxes/${encodeURIComponent(String(inboxId))}/messages/${encodeURIComponent(messageId)}`, init);
  const rawUrl = jsonText(details.raw_message_url);

  if (!rawUrl) return emailFromDetails(details, options);

  const raw = await fetchBytes(provider, rawUrl, { fetch: options.fetch, signal: options.signal });
  const email = emailFromMime({ provider, raw, id: jsonText(details.id), payload: { kind: "json", value: details } });

  return email;
}
