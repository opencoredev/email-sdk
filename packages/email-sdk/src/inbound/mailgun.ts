import { type JsonValue, isJsonString, parseJson } from "../internal/decode.js";
import { parseAddress, parseAddressList } from "./mime.js";
import { emailFromMime, headerFields, mergeSecurity } from "./normalize.js";
import {
  type InboundFetchOptions,
  type InboundForm,
  decodeHexStrict,
  encodeBase64,
  fetchJson,
  formField,
  hmac,
  inlineAttachment,
  jsonList,
  jsonNumber,
  jsonObject,
  jsonText,
  parseFormBody,
  payloadError,
  rejected,
  signingSecrets,
  timestampFresh,
  timingSafeEqual,
  utf8Bytes,
  verdict,
  verified,
} from "./shared.js";
import {
  type InboundEmail,
  type InboundFormFields,
  InboundHeaders,
  type InboundRequestPayload,
  type InboundSecurity,
  type InboundSignatureOptions,
  type InboundVerification,
} from "./types.js";

const provider = "mailgun";

export interface MailgunInboundApiOptions extends InboundFetchOptions {
  apiKey: string;
}

function headerPairs(value: string | undefined): InboundHeaders {
  const parsed = value === undefined ? undefined : parseJson(value);

  return new InboundHeaders(jsonList(parsed).flatMap(pair => {
    const [name, entry] = jsonList(pair);

    return isJsonString(name) && isJsonString(entry) ? [{ name, value: entry }] : [];
  }));
}

function mailgunSecurity(headers: InboundHeaders): InboundSecurity {
  const flag = headers.get("x-mailgun-sflag")?.trim().toLowerCase();

  return mergeSecurity({}, {
    spf: verdict(headers.get("x-mailgun-spf")),
    dkim: verdict(headers.get("x-mailgun-dkim-check-result")),
    spam: flag === "yes" ? "fail" : flag === "no" ? "pass" : undefined,
    spamScore: jsonNumber(headers.get("x-mailgun-sscore")),
  });
}

/**
 * Verify the `timestamp`, `token`, and `signature` fields Mailgun adds to route posts.
 * The secret is the HTTP webhook signing key. Mailgun signs `timestamp + token`, not the
 * message, so also reject reused tokens with persistent storage.
 */
export async function verifyMailgunInbound(
  payload: InboundRequestPayload | InboundForm,
  options: InboundSignatureOptions,
): Promise<InboundVerification> {
  const secrets = signingSecrets(options.secret);

  if (!secrets.length) return rejected("secret_missing");

  let fields: InboundFormFields;

  try {
    fields = "fields" in payload ? payload.fields : (await parseFormBody(provider, payload)).fields;
  } catch {
    return rejected("payload_invalid");
  }

  const timestamp = formField(fields, "timestamp");
  const token = formField(fields, "token");
  const signature = formField(fields, "signature");

  if (!timestamp || !token || !signature) return rejected("signature_missing");

  if (!timestampFresh(timestamp, options)) return rejected("timestamp_expired");

  let presented: Uint8Array;

  try {
    presented = decodeHexStrict(signature);
  } catch {
    return rejected("signature_invalid");
  }

  for (const secret of secrets) {
    const expected = await hmac("SHA-256", utf8Bytes(secret), utf8Bytes(`${timestamp}${token}`));

    if (timingSafeEqual(presented, expected)) return verified;
  }

  return rejected("signature_invalid");
}

async function emailFromForm(form: InboundForm, payload: InboundEmail["raw"]): Promise<InboundEmail> {
  const { fields, files } = form;
  const recipient = formField(fields, "recipient");
  const sender = formField(fields, "sender");
  const envelope = { from: sender, to: parseAddressList(recipient).map(entry => entry.address) };
  const mime = formField(fields, "body-mime");

  if (mime !== undefined) {
    const email = emailFromMime({ provider, raw: mime, envelope, payload });
    email.security = mergeSecurity(email.security, mailgunSecurity(email.headers));

    return email;
  }

  const headers = headerPairs(formField(fields, "message-headers"));
  const fromHeaders = headerFields(headers);
  const contentIds = new Map<string, string>();
  const idMap = jsonObject(parseJson(formField(fields, "content-id-map") ?? ""));

  for (const [cid, field] of Object.entries(idMap ?? {})) {
    const name = jsonText(field);

    if (name) contentIds.set(name, cid.replace(/^<|>$/g, ""));
  }

  const attachments = [];

  for (const [field, file] of files) {
    if (!/^attachment-\d+$/.test(field)) continue;

    const contentId = contentIds.get(field);

    attachments.push(inlineAttachment({
      filename: file.name || undefined,
      contentType: file.type || "application/octet-stream",
      contentId,
      disposition: contentId ? "inline" : "attachment",
      content: new Uint8Array(await file.arrayBuffer()),
    }));
  }

  return {
    provider,
    ...fromHeaders,
    id: fromHeaders.messageId,
    from: parseAddress(formField(fields, "from")) ?? fromHeaders.from,
    subject: formField(fields, "subject") ?? fromHeaders.subject,
    text: formField(fields, "body-plain"),
    html: formField(fields, "body-html"),
    headers,
    attachments,
    security: mailgunSecurity(headers),
    envelope,
    raw: payload,
  };
}

/**
 * Parse a Mailgun route `forward()` post (multipart/form-data or urlencoded). Routes that
 * forward to a URL ending in `mime` deliver the raw message in `body-mime`, which is parsed
 * with full MIME fidelity.
 */
export async function parseMailgunInbound(payload: InboundRequestPayload): Promise<InboundEmail> {
  const form = await parseFormBody(provider, payload);

  if (!formField(form.fields, "recipient") && !formField(form.fields, "body-mime") && !form.fields.has("body-plain")) {
    throw payloadError(provider, "Mailgun inbound post has no recipient, body-plain, or body-mime field.");
  }

  return emailFromForm(form, { kind: "form", fields: form.fields });
}

/**
 * Fetch a message kept by a route's `store()` action. Pass the `url` from the stored event
 * (`https://storage-<region>.api.mailgun.net/v3/domains/<domain>/messages/<key>`).
 */
export async function fetchMailgunStoredEmail(
  storageUrl: string,
  options: MailgunInboundApiOptions,
): Promise<InboundEmail> {
  const url = new URL(storageUrl);

  if (url.protocol !== "https:" || !/^(?:storage-[a-z0-9-]+\.)?api\.(?:eu\.)?mailgun\.net$/.test(url.hostname)) {
    throw payloadError(provider, "Mailgun storage URL must be an https://storage-*.api.mailgun.net URL.");
  }

  const data = await fetchJson(provider, url, {
    headers: { Authorization: `Basic ${encodeBase64(utf8Bytes(`api:${options.apiKey}`))}`, Accept: "message/rfc2822" },
    fetch: options.fetch,
    signal: options.signal,
  });

  const mime = jsonText(data["body-mime"]);

  if (mime === undefined) throw payloadError(provider, "Mailgun stored message response has no body-mime field.");

  const recipients: JsonValue | undefined = data.recipients ?? data.recipient;

  return emailFromMime({
    provider,
    raw: mime,
    envelope: { from: jsonText(data.sender), to: parseAddressList(jsonText(recipients)).map(entry => entry.address) },
    payload: { kind: "json", value: data },
  });
}
