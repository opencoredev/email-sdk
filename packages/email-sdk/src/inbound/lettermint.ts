import type { JsonObject, JsonValue } from "../internal/decode.js";
import { parseAddressList } from "./mime.js";
import {
  type InboundFetchOptions,
  decodeBase64,
  fetchBytes,
  firstMessageId,
  inlineAttachment,
  jsonContent,
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
  verdict,
  verifyTimestampedHmac,
} from "./shared.js";
import {
  type InboundAddress,
  type InboundEmail,
  InboundHeaders,
  type InboundRequestPayload,
  type InboundSignatureOptions,
  type InboundVerification,
} from "./types.js";

const provider = "lettermint";

/**
 * Verify `X-Lettermint-Signature: t=<unix>,v1=<hex>` (HMAC-SHA256 over `<t>.<body>` with the
 * `whsec_` secret used as-is) and check that `X-Lettermint-Delivery` matches `t`.
 */
export async function verifyLettermintInbound(
  payload: InboundRequestPayload,
  options: InboundSignatureOptions,
): Promise<InboundVerification> {
  const header = readHeader(payload.headers, "x-lettermint-signature");
  const delivery = readHeader(payload.headers, "x-lettermint-delivery");
  const timestamp = /(?:^|,)\s*t=(\d+)/.exec(header ?? "")?.[1];

  if (header && delivery !== undefined && timestamp !== undefined && delivery.trim() !== timestamp) {
    return rejected("signature_invalid");
  }

  if (header && delivery === undefined) return rejected("signature_missing");

  return verifyTimestampedHmac(header, payload.body, options);
}

function address(value: JsonValue | undefined): InboundAddress | undefined {
  const item = jsonObject(value);
  const email = jsonText(item?.email);
  const name = jsonText(item?.name);

  return email ? (name ? { address: email, name } : { address: email }) : undefined;
}

function emailFromData(data: JsonObject, root: JsonObject, options: InboundFetchOptions): InboundEmail {
  const headers = new InboundHeaders(jsonList(data.headers).flatMap(entry => {
    const item = jsonObject(entry);
    const name = jsonText(item?.name);
    const value = jsonText(item?.value);

    return name && value !== undefined ? [{ name, value }] : [];
  }));

  const auth = jsonObject(data.authentication_results);
  const envelope = jsonObject(data.envelope);
  const body = jsonObject(data.body);
  const recipient = jsonText(data.recipient);
  const isSpam = data.is_spam;

  return {
    provider,
    id: jsonText(data.message_id),
    messageId: firstMessageId(headers.get("message-id")),
    from: address(data.from),
    to: jsonList(data.to).flatMap(entry => address(entry) ?? []),
    cc: jsonList(data.cc).flatMap(entry => address(entry) ?? []),
    bcc: [],
    replyTo: parseAddressList(jsonText(data.reply_to)),
    subject: jsonText(data.subject),
    text: jsonText(body?.text),
    html: jsonText(body?.html),
    headers,
    attachments: jsonList(data.attachments).flatMap(entry => {
      const item = jsonObject(entry);

      if (!item) return [];

      const contentId = jsonText(item.content_id)?.replace(/^<|>$/g, "");

      const details = {
        filename: jsonText(item.filename),
        contentType: jsonText(item.content_type) ?? "application/octet-stream",
        size: jsonNumber(item.size),
        contentId,
        disposition: contentId ? "inline" as const : "attachment" as const,
      };

      const content = jsonContent(item.content);
      const url = jsonText(item.url);

      if (content !== undefined) return [inlineAttachment({ ...details, content: decodeBase64(content) })];

      if (url) return [remoteAttachment({ ...details, url }, () => fetchBytes(provider, url, options))];

      return [];
    }),
    inReplyTo: firstMessageId(headers.get("in-reply-to")),
    references: messageIds(headers.get("references")),
    date: parseDate(jsonText(data.date)),
    security: {
      spf: verdict(jsonText(jsonObject(auth?.spf)?.result)),
      dkim: verdict(jsonText(jsonObject(auth?.dkim)?.result)),
      dmarc: verdict(jsonText(jsonObject(auth?.dmarc)?.result)),
      spam: isSpam === true ? "fail" : isSpam === false ? "pass" : undefined,
      spamScore: jsonNumber(data.spam_score),
    },
    envelope: { from: jsonText(envelope?.mail_from), to: recipient ? [recipient] : [] },
    raw: { kind: "json", value: root },
  };
}

/**
 * Parse a Lettermint `message.inbound` webhook. Attachments delivered as signed URLs are read
 * on demand with `attachment.read()`. The original `.eml` is at `raw.value.data.raw.url`.
 */
export function parseLettermintInbound(payload: InboundRequestPayload, options: InboundFetchOptions = {}): InboundEmail {
  const root = parseJsonObjectBody(provider, payload.body);

  if (jsonText(root.event) !== "message.inbound") {
    throw payloadError(provider, `Lettermint event ${jsonText(root.event) ?? "(missing)"} is not message.inbound.`);
  }

  const data = jsonObject(root.data);

  if (!data) throw payloadError(provider, "Lettermint message.inbound webhook has no data object.");

  return emailFromData(data, root, options);
}
