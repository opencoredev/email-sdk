import type { JsonObject, JsonValue } from "../internal/decode.js";
import { parseAddressList } from "./mime.js";
import { authenticationResults, mergeSecurity } from "./normalize.js";
import {
  type InboundFetchOptions,
  decodeBase64,
  fetchJson,
  firstMessageId,
  inlineAttachment,
  jsonList,
  jsonNumber,
  jsonObject,
  jsonText,
  messageIds,
  parseDate,
  parseJsonObjectBody,
} from "./shared.js";
import {
  type InboundAddress,
  type InboundEmail,
  InboundHeaders,
  type InboundRequestPayload,
} from "./types.js";

const provider = "postmark";

export interface PostmarkInboundApiOptions extends InboundFetchOptions {
  serverToken: string;
  baseUrl?: string;
}

function fullAddresses(full: JsonValue | undefined, fallback: JsonValue | undefined): InboundAddress[] {
  const list = jsonList(full).flatMap(entry => {
    const item = jsonObject(entry);
    const address = jsonText(item?.Email);

    if (!address) return [];

    const name = jsonText(item?.Name);

    return [name ? { address, name } : { address }];
  });

  return list.length ? list : parseAddressList(jsonText(fallback));
}

function emailFromJson(data: JsonObject): InboundEmail {
  const headers = new InboundHeaders(jsonList(data.Headers).flatMap(entry => {
    const item = jsonObject(entry);
    const name = jsonText(item?.Name);
    const value = jsonText(item?.Value);

    return name && value !== undefined ? [{ name, value }] : [];
  }));

  const spamStatus = headers.get("x-spam-status")?.trim().toLowerCase();
  const from = fullAddresses(data.FromFull ? [data.FromFull] : undefined, data.From)[0];
  const original = jsonText(data.OriginalRecipient);

  return {
    provider,
    id: jsonText(data.MessageID),
    messageId: firstMessageId(headers.get("message-id")) ?? jsonText(data.MessageID),
    from,
    to: fullAddresses(data.ToFull, data.To),
    cc: fullAddresses(data.CcFull, data.Cc),
    bcc: fullAddresses(data.BccFull, data.Bcc),
    replyTo: parseAddressList(jsonText(data.ReplyTo)),
    subject: jsonText(data.Subject),
    text: jsonText(data.TextBody),
    html: jsonText(data.HtmlBody),
    headers,
    attachments: jsonList(data.Attachments).flatMap(entry => {
      const item = jsonObject(entry);
      const content = jsonText(item?.Content);

      if (!item || content === undefined) return [];

      const contentId = jsonText(item.ContentID)?.replace(/^<|>$/g, "");

      return [inlineAttachment({
        filename: jsonText(item.Name),
        contentType: jsonText(item.ContentType) ?? "application/octet-stream",
        contentId,
        disposition: contentId ? "inline" : "attachment",
        content: decodeBase64(content),
      })];
    }),
    inReplyTo: firstMessageId(headers.get("in-reply-to")),
    references: messageIds(headers.get("references")),
    date: parseDate(jsonText(data.Date)),
    security: mergeSecurity(authenticationResults(headers), {
      spam: spamStatus?.startsWith("yes") ? "fail" : spamStatus?.startsWith("no") ? "pass" : undefined,
      spamScore: jsonNumber(headers.get("x-spam-score")),
    }),
    envelope: original ? { to: [original] } : undefined,
    raw: { kind: "json", value: data },
  };
}

/**
 * Parse a Postmark inbound webhook. Postmark does not sign inbound requests; protect the
 * endpoint with Basic credentials in the webhook URL and check them with `verifyBasicAuth`.
 */
export function parsePostmarkInbound(payload: InboundRequestPayload): InboundEmail {
  return emailFromJson(parseJsonObjectBody(provider, payload.body));
}

/** Fetch an inbound message's details from the Postmark Messages API. */
export async function fetchPostmarkInboundEmail(
  messageId: string,
  options: PostmarkInboundApiOptions,
): Promise<InboundEmail> {
  const baseUrl = options.baseUrl ?? "https://api.postmarkapp.com";

  const data = await fetchJson(provider, `${baseUrl}/messages/inbound/${encodeURIComponent(messageId)}/details`, {
    headers: { Accept: "application/json", "X-Postmark-Server-Token": options.serverToken },
    fetch: options.fetch,
    signal: options.signal,
  });

  return emailFromJson(data);
}
