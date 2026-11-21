import { decodeBase64Strict } from "../inbound/shared.js";

/**
 * SendGrid signs both the Event Webhook and Inbound Parse the same way: ECDSA P-256 / SHA-256
 * over the `X-Twilio-Email-Event-Webhook-Timestamp` value followed by the raw body, with a
 * base64 DER signature in `X-Twilio-Email-Event-Webhook-Signature`.
 */
export type SendGridSignatureResult = "verified" | "signature_invalid" | "secret_missing";

/** Convert a strict DER ECDSA signature to the raw `r || s` form WebCrypto verifies. */
function derToRaw(der: Uint8Array, size: number): Uint8Array<ArrayBuffer> | undefined {
  if (der.length < 8 || der[0] !== 0x30) return undefined;

  let offset = 2;
  let seqLength = der[1]!;

  if (seqLength & 0x80) {
    const lengthBytes = seqLength & 0x7f;

    if (lengthBytes === 0 || lengthBytes > 2 || offset + lengthBytes > der.length) return undefined;

    seqLength = 0;

    for (let index = 0; index < lengthBytes; index += 1) {
      seqLength = (seqLength << 8) | der[offset + index]!;
    }

    offset += lengthBytes;
  }

  if (offset + seqLength !== der.length) return undefined;

  const raw = new Uint8Array(size * 2);

  for (let index = 0; index < 2; index += 1) {
    if (offset + 2 > der.length || der[offset] !== 0x02) return undefined;

    const length = der[offset + 1]!;

    if (length === 0 || (length & 0x80) !== 0 || offset + 2 + length > der.length) return undefined;

    let value = der.subarray(offset + 2, offset + 2 + length);

    while (value.length > size && value[0] === 0) value = value.subarray(1);

    if (value.length > size) return undefined;

    raw.set(value, index * size + size - value.length);
    offset += 2 + length;
  }

  if (offset !== der.length) return undefined;

  return raw;
}

export async function verifySendGridSignature(options: {
  /** Base64 SPKI public keys, PEM armor allowed. Several keys support rotation. */
  publicKeys: readonly string[];
  signature: string;
  timestamp: string;
  body: Uint8Array;
}): Promise<SendGridSignatureResult> {
  if (!options.publicKeys.length) return "secret_missing";

  let raw: Uint8Array<ArrayBuffer> | undefined;

  try {
    raw = derToRaw(decodeBase64Strict(options.signature), 32);
  } catch {
    return "signature_invalid";
  }

  if (!raw) return "signature_invalid";

  const timestamp = new TextEncoder().encode(options.timestamp);
  const signed = new Uint8Array(timestamp.length + options.body.length);
  signed.set(timestamp);
  signed.set(options.body, timestamp.length);

  // A malformed key is skipped, so one bad entry in a rotation list cannot block the valid one.
  let usable = 0;

  for (const key of options.publicKeys) {
    let cryptoKey: CryptoKey;

    try {
      cryptoKey = await crypto.subtle.importKey(
        "spki",
        decodeBase64Strict(key.replace(/-----[^-]+-----|\s/g, "")),
        { name: "ECDSA", namedCurve: "P-256" },
        false,
        ["verify"],
      );
    } catch {
      continue;
    }

    usable += 1;

    if (await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, cryptoKey, raw, signed)) {
      return "verified";
    }
  }

  return usable ? "signature_invalid" : "secret_missing";
}
