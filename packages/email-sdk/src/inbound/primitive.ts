import type { JsonObject } from "../internal/decode.js";
import { emailFromMime, mergeSecurity } from "./normalize.js";
import {
  type InboundFetchOptions,
  decodeBase64,
  fetchBytes,
  jsonList,
  jsonNumber,
  jsonObject,
  jsonText,
  parseJsonObjectBody,
  payloadError,
  readHeader,
  verdict,
  verifyTimestampedHmac,
} from "./shared.js";
import type {
  InboundEmail,
  InboundRequestPayload,
  InboundSecurity,
  InboundSignatureOptions,
  InboundVerification,
} from "./types.js";

const provider = "primitive";

/** Verify `Primitive-Signature: t=<unix>,v1=<hex>`: HMAC-SHA256 over `<t>.<raw body>`. */
export function verifyPrimitiveInbound(
  payload: InboundRequestPayload,
  options: InboundSignatureOptions,
): Promise<InboundVerification> {
  return verifyTimestampedHmac(readHeader(payload.headers, "primitive-signature"), payload.body, options);
}

function primitiveSecurity(email: JsonObject): InboundSecurity {
  const auth = jsonObject(email.auth);
  const dkim = jsonList(auth?.dkimSignatures).map(entry => verdict(jsonText(jsonObject(entry)?.result)));

  return {
    spf: verdict(jsonText(auth?.spf)),
    dmarc: verdict(jsonText(auth?.dmarc)),
    dkim: dkim.includes("pass") ? "pass" : dkim[0],
    spamScore: jsonNumber(jsonObject(jsonObject(email.analysis)?.spamassassin)?.score),
  };
}

/**
 * Parse a Primitive `email.received` webhook. The raw message is used when inlined; larger
 * messages are downloaded from the event's signed `content.download.url`.
 */
export async function parsePrimitiveInbound(
  payload: InboundRequestPayload,
  options: InboundFetchOptions = {},
): Promise<InboundEmail> {
  const root = parseJsonObjectBody(provider, payload.body);

  if (jsonText(root.event) !== "email.received") {
    throw payloadError(provider, `Primitive event ${jsonText(root.event) ?? "(missing)"} is not email.received.`);
  }

  const email = jsonObject(root.email);

  if (!email) throw payloadError(provider, "Primitive email.received webhook has no email object.");

  const content = jsonObject(email.content);
  const inline = jsonObject(content?.raw);
  const data = inline?.included === true ? jsonText(inline.data) : undefined;
  const downloadUrl = jsonText(jsonObject(content?.download)?.url);
  let raw: Uint8Array;

  if (data !== undefined) {
    raw = decodeBase64(data);
  } else if (downloadUrl) {
    raw = await fetchBytes(provider, downloadUrl, options);
  } else {
    throw payloadError(provider, "Primitive webhook has neither inline raw content nor a download URL.");
  }

  const smtp = jsonObject(email.smtp);

  const parsed = emailFromMime({
    provider,
    raw,
    id: jsonText(email.id),
    envelope: { from: jsonText(smtp?.mail_from), to: jsonList(smtp?.rcpt_to).flatMap(entry => jsonText(entry) ?? []) },
    payload: { kind: "json", value: root },
  });

  parsed.security = mergeSecurity(parsed.security, primitiveSecurity(email));

  return parsed;
}
