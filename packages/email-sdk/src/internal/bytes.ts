/**
 * Byte and base64 helpers built on Web APIs (`btoa`, `atob`, `TextEncoder`) instead of Node's
 * `Buffer`, so adapters that import them still bundle for Cloudflare Workers and other edge
 * runtimes without `nodejs_compat`.
 */

const CHUNK = 0x8000;

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";

  // String.fromCharCode takes its arguments on the stack, so large inputs go in chunks.
  for (let offset = 0; offset < bytes.length; offset += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + CHUNK));
  }

  return btoa(binary);
}

export function utf8ToBytes(value: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(value);
}

export function utf8ToBase64(value: string): string {
  return bytesToBase64(utf8ToBytes(value));
}

/**
 * Decodes standard or URL-safe base64 and tolerates whitespace and missing padding, matching
 * what `Buffer.from(value, "base64")` accepted before. Throws on characters outside the
 * base64 alphabet instead of silently dropping them.
 */
export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const clean = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const binary = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
