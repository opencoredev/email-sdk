import type { JsonObject, JsonValue } from "../internal/decode.js";
import {
  type InboundFetchOptions,
  fetchBytes,
  firstMessageId,
  jsonList,
  jsonNumber,
  jsonObject,
  jsonText,
  messageIds,
  parseDate,
  parseJsonObjectBody,
  payloadError,
  remoteAttachment,
} from "./shared.js";
import {
  type InboundAddress,
  type InboundEmail,
  InboundHeaders,
  type InboundRequestPayload,
} from "./types.js";

const provider = "brevo";

export interface BrevoInboundOptions extends InboundFetchOptions {
  /** Brevo API key, used by `attachment.read()` to download attachments. */
  apiKey?: string;
  baseUrl?: string;
}

function mailbox(value: JsonValue | undefined): InboundAddress | undefined {
  const item = jsonObject(value);
  const address = jsonText(item?.Address);
  const name = jsonText(item?.Name);

  return address ? (name ? { address, name } : { address }) : undefined;
}

function mailboxes(value: JsonValue | undefined): InboundAddress[] {
  return jsonList(value).flatMap(entry => mailbox(entry) ?? []);
}

function emailFromItem(item: JsonObject, options: BrevoInboundOptions): InboundEmail {
  const headers = new InboundHeaders(Object.entries(jsonObject(item.Headers) ?? {}).flatMap(([name, value]) => {
    const values = Array.isArray(value) ? value : [value];

    return values.flatMap(entry => {
      const text = jsonText(entry);

      return text === undefined ? [] : [{ name, value: text }];
    });
  }));

  const baseUrl = options.baseUrl ?? "https://api.brevo.com/v3";
  const spam = jsonObject(item.Spam);
  const uuid = jsonList(item.Uuid).flatMap(entry => jsonText(entry) ?? []);
  const replyTo = mailbox(item.ReplyTo);

  return {
    provider,
    id: uuid[0],
    messageId: firstMessageId(jsonText(item.MessageId)) ?? jsonText(item.MessageId),
    from: mailbox(item.From),
    to: mailboxes(item.To),
    cc: mailboxes(item.Cc),
    bcc: [],
    replyTo: replyTo ? [replyTo] : [],
    subject: jsonText(item.Subject),
    text: jsonText(item.RawTextBody) ?? jsonText(item.ExtractedMarkdownMessage),
    html: jsonText(item.RawHtmlBody),
    headers,
    attachments: jsonList(item.Attachments).flatMap(entry => {
      const attachment = jsonObject(entry);
      const token = jsonText(attachment?.DownloadToken);

      if (!attachment) return [];

      const contentId = jsonText(attachment.ContentID)?.replace(/^<|>$/g, "");

      return [remoteAttachment({
        filename: jsonText(attachment.Name),
        contentType: jsonText(attachment.ContentType) ?? "application/octet-stream",
        size: jsonNumber(attachment.ContentLength),
        contentId,
        disposition: contentId ? "inline" : "attachment",
      }, async () => {
        if (!token || !options.apiKey) {
          throw payloadError(provider, "Brevo attachment download needs an apiKey and a DownloadToken.");
        }

        return fetchBytes(provider, `${baseUrl}/inbound/attachments/${encodeURIComponent(token)}`, {
          headers: { "api-key": options.apiKey, Accept: "application/octet-stream" },
          fetch: options.fetch,
          signal: options.signal,
        });
      })];
    }),
    inReplyTo: firstMessageId(jsonText(item.InReplyTo)),
    references: messageIds(headers.get("references")),
    date: parseDate(jsonText(item.SentAtDate)),
    security: { spamScore: jsonNumber(item.SpamScore) ?? jsonNumber(spam?.Score) },
    envelope: {
      to: jsonList(item.Recipients).flatMap(entry => jsonText(entry) ?? mailbox(entry)?.address ?? []),
    },
    raw: { kind: "json", value: item },
  };
}

/**
 * Parse a Brevo inbound parsing webhook (`{ items: [...] }`). Brevo does not sign these
 * requests; configure Basic or Bearer auth on the webhook and check it with
 * `verifyBasicAuth` or `verifyBearerToken`.
 */
export function parseBrevoInbound(payload: InboundRequestPayload, options: BrevoInboundOptions = {}): InboundEmail[] {
  const root = parseJsonObjectBody(provider, payload.body);

  if (!Array.isArray(root.items)) throw payloadError(provider, "Brevo inbound webhook has no items array.");

  return jsonList(root.items).flatMap(entry => {
    const item = jsonObject(entry);

    return item ? [emailFromItem(item, options)] : [];
  });
}
