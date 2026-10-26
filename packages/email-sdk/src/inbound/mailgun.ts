import { type JsonValue, isJsonObject, isJsonString, parseJson } from "../internal/decode.js";
import { parseAddress, parseAddressList, parseMultipartFormData } from "./mime.js";
import { emailFromMime, headerFields, mergeSecurity } from "./normalize.js";
import {
  type InboundFetchOptions,
  type InboundForm,
  decodeHexStrict,
  encodeBase64,
  formField,
  hmac,
  inlineAttachment,
  jsonList,
  jsonNumber,
  jsonObject,
  jsonText,
  parseFormBody,
  parseJsonBody,
  payloadError,
  providerFetch,
  readHeader,
  rejected,
  responseBytes,
  responseText,
  signingSecrets,
  timestampFresh,
  timingSafeEqual,
  toBytes,
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

function hexDigit(byte: number | undefined): number | undefined {
  if (byte === undefined) return undefined;

  const digit = Number.parseInt(String.fromCharCode(byte), 16);

  return Number.isNaN(digit) ? undefined : digit;
}

/** Percent-decode urlencoded bytes to bytes, with `+` as a space. */
function percentDecode(bytes: Uint8Array): Uint8Array {
  const decoded = new Uint8Array(bytes.length);
  let length = 0;

  for (let index = 0; index < bytes.length; index += 1) {
    const byte = bytes[index]!;
    const high = byte === 0x25 ? hexDigit(bytes[index + 1]) : undefined;
    const low = high === undefined ? undefined : hexDigit(bytes[index + 2]);

    if (high !== undefined && low !== undefined) {
      decoded[length] = high * 16 + low;
      index += 2;
    } else {
      decoded[length] = byte === 0x2b ? 0x20 : byte;
    }

    length += 1;
  }

  return decoded.slice(0, length);
}

function urlencodedField(body: Uint8Array, name: string): Uint8Array | undefined {
  const decoder = new TextDecoder();

  for (let start = 0; start <= body.length;) {
    const found = body.indexOf(0x26, start);
    const end = found === -1 ? body.length : found;
    const pair = body.subarray(start, end);
    const equals = pair.indexOf(0x3d);

    if (decoder.decode(percentDecode(equals === -1 ? pair : pair.subarray(0, equals))) === name) {
      return percentDecode(equals === -1 ? new Uint8Array() : pair.subarray(equals + 1));
    }

    start = end + 1;
  }

  return undefined;
}

/**
 * Read `body-mime` as the bytes Mailgun sent. `FormData` decodes text fields as UTF-8, which
 * would corrupt 8bit bodies and attachments in other charsets.
 */
function mimeFieldBytes(payload: InboundRequestPayload): Uint8Array | undefined {
  const contentType = readHeader(payload.headers, "content-type") ?? "";

  if (/^multipart\/form-data/i.test(contentType)) {
    return parseMultipartFormData(payload.body, contentType).find(part => part.name === "body-mime" && part.filename === undefined)?.bytes;
  }

  if (/^application\/x-www-form-urlencoded/i.test(contentType)) return urlencodedField(toBytes(payload.body), "body-mime");

  return undefined;
}

/** Every non-empty value of a field Mailgun may repeat, such as `body-html` for multiple HTML parts. */
function joinedField(fields: InboundFormFields, name: string): string | undefined {
  const values = (fields.get(name) ?? []).filter(Boolean);

  return values.length ? values.join("\n") : undefined;
}

async function emailFromForm(form: InboundForm, payload: InboundEmail["raw"], mime?: Uint8Array): Promise<InboundEmail> {
  const { fields, files } = form;
  const recipient = formField(fields, "recipient");
  const sender = formField(fields, "sender");
  const envelope = { from: sender, to: parseAddressList(recipient).map(entry => entry.address) };

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
    text: joinedField(fields, "body-plain"),
    html: joinedField(fields, "body-html"),
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

  const mime = formField(form.fields, "body-mime");
  const mimeBytes = mime === undefined ? undefined : mimeFieldBytes(payload) ?? utf8Bytes(mime);

  return emailFromForm(form, { kind: "form", fields: form.fields }, mimeBytes);
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

  const response = await providerFetch(provider, url, {
    headers: { Authorization: `Basic ${encodeBase64(utf8Bytes(`api:${options.apiKey}`))}`, Accept: "message/rfc2822" },
    fetch: options.fetch,
    signal: options.signal,
  });

  // Mailgun documents a JSON object with `body-mime` for this Accept header; a raw RFC 2822
  // response is read as the message itself.
  if (!/\bjson\b/i.test(response.headers.get("content-type") ?? "")) {
    return emailFromMime({ provider, raw: await responseBytes(provider, response) });
  }

  const data = parseJsonBody(provider, await responseText(provider, response));

  if (!isJsonObject(data)) throw payloadError(provider, "Mailgun API returned a non-object JSON body.");

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
