import { emailFromMime } from "./normalize.js";
import {
  decodeBase64Strict,
  jsonText,
  parseJsonObjectBody,
  payloadError,
  readHeader,
  rejected,
  toBytes,
  verified,
} from "./shared.js";
import type { InboundEmail, InboundRequestPayload, InboundVerification } from "./types.js";

const provider = "mailpace";

export interface MailPaceInboundVerificationOptions {
  /** The domain's base64 Ed25519 webhook verification public key. */
  publicKey: string | readonly string[];
}

/** Verify `X-MailPace-Signature`: a base64 Ed25519 signature over the raw body. */
export async function verifyMailPaceInbound(
  payload: InboundRequestPayload,
  options: MailPaceInboundVerificationOptions,
): Promise<InboundVerification> {
  const keys = (Array.isArray(options.publicKey) ? options.publicKey : [options.publicKey]).filter(Boolean);

  if (!keys.length) return rejected("secret_missing");

  const header = readHeader(payload.headers, "x-mailpace-signature");

  if (!header) return rejected("signature_missing");

  let signature: Uint8Array<ArrayBuffer>;

  try {
    signature = decodeBase64Strict(header.trim());
  } catch {
    return rejected("signature_invalid");
  }

  const body = toBytes(payload.body);

  for (const key of keys) {
    let cryptoKey: CryptoKey;

    try {
      cryptoKey = await crypto.subtle.importKey("raw", decodeBase64Strict(key.trim()), { name: "Ed25519" }, false, ["verify"]);
    } catch {
      return rejected("secret_missing");
    }

    if (await crypto.subtle.verify({ name: "Ed25519" }, cryptoKey, signature, body)) return verified;
  }

  return rejected("signature_invalid");
}

/** Parse a MailPace inbound webhook. The included `raw` message is parsed for full fidelity. */
export function parseMailPaceInbound(payload: InboundRequestPayload): InboundEmail {
  const root = parseJsonObjectBody(provider, payload.body);
  const raw = jsonText(root.raw);

  if (raw === undefined) throw payloadError(provider, "MailPace inbound webhook has no raw message.");

  return emailFromMime({ provider, raw, id: jsonText(root.messageId), payload: { kind: "json", value: root } });
}
