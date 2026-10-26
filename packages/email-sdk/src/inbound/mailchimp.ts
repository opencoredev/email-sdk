import { type JsonObject, type JsonValue, isJsonBoolean, isJsonString } from "../internal/decode.js";
import { emailFromMime, headerFields, mergeSecurity } from "./normalize.js";
import {
  decodeBase64,
  inlineAttachment,
  jsonContent,
  jsonList,
  jsonNumber,
  jsonObject,
  jsonText,
  parseFormBody,
  parseJsonBody,
  payloadError,
  readHeader,
  utf8Bytes,
  verdict,
  verifyHmac,
} from "./shared.js";
import {
  type InboundAttachment,
  type InboundEmail,
  InboundHeaders,
  type InboundRequestPayload,
  type InboundSecurity,
  type InboundVerification,
} from "./types.js";

const provider = "mailchimp";

export interface MandrillInboundVerificationOptions {
  /** The webhook's authentication key from Mandrill's Webhooks or Inbound settings. */
  secret: string | readonly string[];
  /** The exact webhook URL configured in Mandrill, including any query string. */
  url: string;
}

/**
 * Verify `X-Mandrill-Signature`: base64 HMAC-SHA1 over the webhook URL followed by each
 * POST key and value, sorted by key.
 */
export async function verifyMandrillInbound(
  payload: InboundRequestPayload,
  options: MandrillInboundVerificationOptions,
): Promise<InboundVerification> {
  let fields: ReadonlyMap<string, readonly string[]>;

  try {
    fields = (await parseFormBody(provider, payload)).fields;
  } catch {
    return { ok: false, reason: "payload_invalid" };
  }

  const signed = options.url + [...fields.keys()].sort().map(key => key + (fields.get(key)?.[0] ?? "")).join("");

  return verifyHmac("SHA-1", readHeader(payload.headers, "x-mandrill-signature"), "base64", options.secret, utf8Bytes(signed));
}

/**
 * True for the POST Mandrill sends when a webhook URL is saved and its HEAD probe fails: an empty
 * `mandrill_events` array signed with the public key `test-webhook`. Answer it with a 2xx; it
 * carries no events, and the public key never authenticates a request that does.
 */
export async function isMandrillWebhookTest(
  payload: InboundRequestPayload,
  options: Pick<MandrillInboundVerificationOptions, "url">,
): Promise<boolean> {
  const check = await verifyMandrillInbound(payload, { secret: "test-webhook", url: options.url });

  if (!check.ok) return false;

  const { fields } = await parseFormBody(provider, payload);
  const events = fields.get("mandrill_events");

  if (fields.size !== 1 || events?.length !== 1) return false;

  return events[0]!.trim() === "[]";
}

function mandrillSecurity(message: JsonObject): InboundSecurity {
  const dkim = jsonObject(message.dkim);
  const signedDkim = dkim?.signed;
  const validDkim = dkim?.valid;

  return {
    spf: verdict(jsonText(jsonObject(message.spf)?.result)),
    dkim: isJsonBoolean(validDkim) && validDkim ? "pass" : isJsonBoolean(signedDkim) && signedDkim ? "fail" : signedDkim === false ? "none" : undefined,
    spamScore: jsonNumber(jsonObject(message.spam_report)?.score),
  };
}

function headerObject(value: JsonValue | undefined): InboundHeaders {
  return new InboundHeaders(Object.entries(jsonObject(value) ?? {}).flatMap(([name, entry]) => {
    if (Array.isArray(entry)) return entry.flatMap(item => isJsonString(item) ? [{ name, value: item }] : []);

    return isJsonString(entry) ? [{ name, value: entry }] : [];
  }));
}

/** One `attachments` or `images` entry. Images carry no `base64` flag; their content is always base64. */
function mandrillAttachment(entry: JsonValue, contentId?: string): InboundAttachment[] {
  const item = jsonObject(entry);
  const content = jsonContent(item?.content);

  if (!item || content === undefined) return [];

  return [inlineAttachment({
    filename: jsonText(item.name),
    contentType: jsonText(item.type) ?? "application/octet-stream",
    contentId: contentId || undefined,
    disposition: contentId ? "inline" : "attachment",
    content: item.base64 === false ? utf8Bytes(content) : decodeBase64(content),
  })];
}

function emailFromEvent(event: JsonObject): InboundEmail {
  const message = jsonObject(event.msg);

  if (!message) throw payloadError(provider, "Mandrill inbound event has no msg object.");

  const recipient = jsonText(message.email);
  const envelope = { to: recipient ? [recipient] : [] };
  const raw = jsonText(message.raw_msg);
  const payload = { kind: "json" as const, value: event };

  if (raw !== undefined) {
    const email = emailFromMime({ provider, raw, envelope, payload });
    email.security = mergeSecurity(email.security, mandrillSecurity(message));

    return email;
  }

  const headers = headerObject(message.headers);
  const name = jsonText(message.from_name);
  const address = jsonText(message.from_email);
  const fields = headerFields(headers);

  // Header fields fill in what the parsed payload omits, like Message-ID and References.
  return {
    ...fields,
    provider,
    from: address ? (name ? { address, name } : { address }) : fields.from,
    to: jsonList(message.to).flatMap(pair => {
      const [entry, label] = jsonList(pair);
      const to = jsonText(entry);
      const display = jsonText(label);

      return to ? [display ? { address: to, name: display } : { address: to }] : [];
    }),
    subject: jsonText(message.subject) ?? fields.subject,
    text: jsonText(message.text),
    html: jsonText(message.html),
    headers,
    attachments: [
      ...Object.values(jsonObject(message.attachments) ?? {}).flatMap(entry => mandrillAttachment(entry)),
      // Mandrill keys `images` by Content-ID, the value an HTML `cid:` link names.
      ...Object.entries(jsonObject(message.images) ?? {}).flatMap(([key, entry]) => mandrillAttachment(entry, key.replace(/^<|>$/g, ""))),
    ],
    security: mandrillSecurity(message),
    envelope,
    raw: payload,
  };
}

/**
 * Parse a Mailchimp Transactional (Mandrill) inbound webhook. One request can carry many
 * events; non-`inbound` events are skipped.
 */
export async function parseMandrillInbound(payload: InboundRequestPayload): Promise<InboundEmail[]> {
  const { fields } = await parseFormBody(provider, payload);
  const events = fields.get("mandrill_events")?.[0];

  if (events === undefined) throw payloadError(provider, "Mandrill webhook has no mandrill_events field.");

  return jsonList(parseJsonBody(provider, events)).flatMap(entry => {
    const event = jsonObject(entry);

    return event && jsonText(event.event) === "inbound" ? [emailFromEvent(event)] : [];
  });
}
