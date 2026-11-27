import type { JsonObject, JsonValue } from "../internal/decode.js";
import { emailFromMime, mergeSecurity } from "./normalize.js";
import {
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
  verifyStandardWebhook,
} from "./shared.js";
import {
  type InboundAddress,
  type InboundAttachment,
  type InboundEmail,
  InboundHeaders,
  type InboundRequestPayload,
  type InboundSecurity,
  type InboundSignatureOptions,
  type InboundVerification,
} from "./types.js";

const provider = "nightmail";

/**
 * Verify a Nightmail webhook's Standard Webhooks signature: base64 HMAC-SHA256 over
 * `webhook-id.webhook-timestamp.body`, keyed with the `whsec_` signing secret Nightmail
 * returns when the webhook is created or rotated.
 */
export function verifyNightmailInbound(
  payload: InboundRequestPayload,
  options: InboundSignatureOptions,
): Promise<InboundVerification> {
  return verifyStandardWebhook(payload, options, "webhook");
}

/** An `InboundAddressGroup`: `{ text, addresses: [{ name, address }] }`. */
function addresses(value: JsonValue | undefined): InboundAddress[] {
  return jsonList(jsonObject(value)?.addresses).flatMap(entry => {
    const item = jsonObject(entry);
    const address = jsonText(item?.address);

    if (!address) return [];

    const name = jsonText(item?.name);

    return [name ? { address, name } : { address }];
  });
}

function headerRecord(value: JsonValue | undefined): InboundHeaders {
  return new InboundHeaders(Object.entries(jsonObject(value) ?? {}).flatMap(([name, entry]) => {
    const text = jsonText(entry);

    return text === undefined ? [] : [{ name, value: text }];
  }));
}

function attachments(value: JsonValue | undefined): InboundAttachment[] {
  return jsonList(value).flatMap(entry => {
    const item = jsonObject(entry);

    if (!item) return [];

    return [remoteAttachment({
      filename: jsonText(item.filename),
      contentType: jsonText(item.contentType) ?? "application/octet-stream",
      size: jsonNumber(item.size),
      contentId: jsonText(item.contentId)?.replace(/^<|>$/g, ""),
      disposition: jsonText(item.contentDisposition) === "inline" ? "inline" : "attachment",
      url: jsonText(item.downloadUrl),
    }, async () => {
      throw payloadError(provider, "Nightmail attachment content is not in the webhook; download it from its url with an admin API key.");
    })];
  });
}

function nightmailSecurity(email: JsonObject): InboundSecurity {
  const junk = jsonObject(email.spam)?.isJunk;

  return junk === true ? { spam: "fail" } : junk === false ? { spam: "pass" } : {};
}

/** Build the email from the parsed JSON fields when the webhook carries no raw MIME. */
function emailFromParsedData(email: JsonObject, parsed: JsonObject, root: JsonObject): InboundEmail {
  const headers = headerRecord(parsed.headers);

  return {
    provider,
    id: jsonText(email.id),
    messageId: firstMessageId(jsonText(parsed.messageId) ?? jsonText(email.messageId)),
    from: addresses(parsed.from)[0] ?? addresses(email.from)[0],
    to: addresses(parsed.to),
    cc: addresses(parsed.cc),
    bcc: [],
    replyTo: addresses(parsed.replyTo),
    subject: jsonText(parsed.subject) ?? jsonText(email.subject),
    text: jsonText(parsed.textBody),
    html: jsonText(parsed.htmlBody),
    headers,
    attachments: attachments(parsed.attachments),
    inReplyTo: firstMessageId(jsonText(parsed.inReplyTo)),
    references: jsonList(parsed.references).flatMap(entry => messageIds(jsonText(entry))),
    date: parseDate(jsonText(parsed.date) ?? jsonText(email.receivedAt)),
    security: nightmailSecurity(email),
    raw: { kind: "json", value: root },
  };
}

/**
 * Parse a Nightmail webhook created with `format: "inbound"`, whose body is an `email.received`
 * event. The original MIME is parsed when it is inlined (messages up to 2 MiB); a larger
 * message falls back to Nightmail's parsed text, HTML, headers, and attachment metadata.
 */
export function parseNightmailInbound(payload: InboundRequestPayload): InboundEmail {
  const root = parseJsonObjectBody(provider, payload.body);
  const event = jsonText(root.event) ?? jsonText(root.type);

  if (event !== "email.received") {
    throw payloadError(provider, `Nightmail event ${event ?? "(missing)"} is not email.received; create the webhook with format "inbound".`);
  }

  const email = jsonObject(root.email);
  const parsed = jsonObject(email?.parsedData);

  if (!email || !parsed) throw payloadError(provider, "Nightmail email.received webhook has no email.parsedData object.");

  const envelope = {
    to: jsonList(email.envelopeRecipients).flatMap(entry => jsonText(entry) ?? []),
  };

  const raw = jsonText(parsed.raw);

  if (raw === undefined) return { ...emailFromParsedData(email, parsed, root), envelope };

  const message = emailFromMime({
    provider,
    raw,
    id: jsonText(email.id),
    envelope,
    payload: { kind: "json", value: root },
  });

  message.security = mergeSecurity(message.security, nightmailSecurity(email));

  return message;
}
