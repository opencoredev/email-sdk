import { parseAddress, parseAddressList } from "./mime.js";
import { authenticationResults } from "./normalize.js";
import {
  decodeBase64,
  firstMessageId,
  inlineAttachment,
  jsonList,
  jsonNumber,
  jsonObject,
  jsonText,
  messageIds,
  parseDate,
  parseJsonObjectBody,
  readHeader,
  rejected,
  signingSecrets,
  timestampFresh,
  toText,
  utf8Bytes,
  verifyHmac,
} from "./shared.js";
import {
  type InboundEmail,
  InboundHeaders,
  type InboundRequestPayload,
  type InboundSignatureOptions,
  type InboundVerification,
} from "./types.js";

const provider = "jetemail";

/** Verify `X-Webhook-Signature`: hex HMAC-SHA256 over `<X-Webhook-ID>.<X-Webhook-Timestamp>.<body>`. */
export async function verifyJetEmailInbound(
  payload: InboundRequestPayload,
  options: InboundSignatureOptions,
): Promise<InboundVerification> {
  if (!signingSecrets(options.secret).length) return rejected("secret_missing");

  const id = readHeader(payload.headers, "x-webhook-id");
  const timestamp = readHeader(payload.headers, "x-webhook-timestamp");
  const signature = readHeader(payload.headers, "x-webhook-signature");

  if (!id || !timestamp || !signature) return rejected("signature_missing");

  if (!timestampFresh(timestamp, options)) return rejected("timestamp_expired");

  return verifyHmac("SHA-256", signature, "hex", options.secret, utf8Bytes(`${id}.${timestamp}.${toText(payload.body)}`));
}

/** Parse a JetEmail inbound webhook. */
export function parseJetEmailInbound(payload: InboundRequestPayload): InboundEmail {
  const root = parseJsonObjectBody(provider, payload.body);

  const headers = new InboundHeaders(Object.entries(jsonObject(root.headers) ?? {}).flatMap(([name, value]) => {
    if (Array.isArray(value)) {
      return value.flatMap(item => {
        const text = jsonText(item);

        return text === undefined ? [] : [{ name, value: text }];
      });
    }

    const text = jsonText(value);

    return text === undefined ? [] : [{ name, value: text }];
  }));

  const to = parseAddressList(jsonText(root.to));

  return {
    provider,
    id: jsonText(root.uid),
    messageId: firstMessageId(`<${(jsonText(root.messageId) ?? "").replace(/^<|>$/g, "")}>`),
    from: parseAddress(jsonText(root.from)),
    to,
    cc: parseAddressList(jsonText(root.cc)),
    bcc: parseAddressList(jsonText(root.bcc)),
    replyTo: parseAddressList(jsonText(root.replyTo)),
    subject: jsonText(root.subject),
    text: jsonText(root.textBody),
    html: jsonText(root.htmlBody),
    headers,
    attachments: jsonList(root.attachments).flatMap(entry => {
      const item = jsonObject(entry);
      const content = jsonText(item?.content);

      if (!item || content === undefined) return [];

      return [inlineAttachment({
        filename: jsonText(item.filename),
        contentType: jsonText(item.content_type) ?? "application/octet-stream",
        size: jsonNumber(item.size),
        contentId: jsonText(item.content_id)?.replace(/^<|>$/g, ""),
        disposition: jsonText(item.disposition) === "inline" ? "inline" : "attachment",
        content: decodeBase64(content),
      })];
    }),
    inReplyTo: firstMessageId(headers.get("in-reply-to")),
    references: messageIds(headers.get("references")),
    date: parseDate(jsonText(root.date)),
    security: authenticationResults(headers),
    raw: { kind: "json", value: root },
  };
}
