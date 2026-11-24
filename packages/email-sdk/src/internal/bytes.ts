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
 * what `Buffer.from(value, "base64")` accepted before. Throws on invalid padding, non-canonical
 * pad bits, or characters outside the base64 alphabet instead of silently accepting garbage.
 */
export function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const stripped = value.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");

  if (stripped.length === 0) return new Uint8Array(0);

  if (stripped.includes("=")) {
    if (stripped.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={1,2}$/.test(stripped)) {
      throw new Error("Invalid base64 padding.");
    }
  } else if (stripped.length % 4 === 1 || !/^[A-Za-z0-9+/]+$/.test(stripped)) {
    throw new Error("Invalid base64 encoding.");
  }

  const unpadded = stripped.replace(/=+$/, "");
  const padded = unpadded + "=".repeat((4 - (unpadded.length % 4)) % 4);
  const binary = atob(padded);

  if (btoa(binary).replace(/=+$/, "") !== unpadded) {
    throw new Error("Invalid base64 padding bits.");
  }

  const bytes = new Uint8Array(binary.length);

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}
