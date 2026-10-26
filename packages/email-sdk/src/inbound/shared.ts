import {
  type JsonObject,
  type JsonValue,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  isStringMember,
  parseJsonStrict,
} from "../internal/decode.js";
import {
  InboundError,
  type InboundAddress,
  type InboundAttachment,
  type InboundClockOptions,
  type InboundFormFields,
  type InboundHeadersInit,
  type InboundProvider,
  type InboundRequestPayload,
  type InboundSignatureOptions,
  type InboundVerdict,
  type InboundVerification,
} from "./types.js";

const encoder = new TextEncoder();

const utf8 = new TextDecoder();

export function toBytes(body: string | Uint8Array): Uint8Array<ArrayBuffer> {
  if (isStringMember(body)) return encoder.encode(body);

  const copy = new Uint8Array(body.byteLength);
  copy.set(body);

  return copy;
}

export function toText(body: string | Uint8Array): string {
  return isStringMember(body) ? body : utf8.decode(body);
}

export function utf8Bytes(value: string): Uint8Array<ArrayBuffer> {
  return encoder.encode(value);
}

/** Read one header case-insensitively. Duplicate plain-record keys are rejected. */
export function readHeader(headers: InboundHeadersInit | undefined, name: string): string | undefined {
  if (!headers) return undefined;

  if (headers instanceof Headers) return headers.get(name) ?? undefined;

  const key = name.toLowerCase();
  const matches = Object.entries(headers).filter(([candidate]) => candidate.toLowerCase() === key);

  if (matches.length > 1) return undefined;

  const value = matches[0]?.[1];

  return value === undefined || value === "" ? undefined : value;
}

export function payloadError(provider: InboundProvider, message: string, cause?: Error): InboundError {
  return new InboundError(message, { reason: "payload_invalid", provider, cause });
}

export function parseJsonBody(provider: InboundProvider, body: string | Uint8Array): JsonValue {
  try {
    return parseJsonStrict(toText(body));
  } catch (error) {
    throw payloadError(provider, `${provider} inbound body is not valid JSON.`, error instanceof Error ? error : undefined);
  }
}

export function parseJsonObjectBody(provider: InboundProvider, body: string | Uint8Array): JsonObject {
  const value = parseJsonBody(provider, body);

  if (!isJsonObject(value)) throw payloadError(provider, `${provider} inbound body must be a JSON object.`);

  return value;
}

export function jsonObject(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

export function jsonText(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.length > 0 ? value : undefined;
}

/** A JSON string, including the empty string (valid zero-byte attachment content). */
export function jsonContent(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) ? value : undefined;
}

export function jsonNumber(value: JsonValue | undefined): number | undefined {
  if (isJsonNumber(value) && Number.isFinite(value)) return value;

  if (isJsonString(value) && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);

  return undefined;
}

export function jsonList(value: JsonValue | undefined): readonly JsonValue[] {
  return Array.isArray(value) ? value : [];
}

export interface InboundForm {
  fields: InboundFormFields;
  files: ReadonlyMap<string, File>;
}

/** Parse a multipart/form-data or urlencoded body with the platform `FormData` parser. */
export async function parseFormBody(provider: InboundProvider, payload: InboundRequestPayload): Promise<InboundForm> {
  const contentType = readHeader(payload.headers, "content-type");

  if (!contentType) throw payloadError(provider, `${provider} inbound request is missing a Content-Type header.`);

  let form: FormData;

  try {
    form = await new Response(toBytes(payload.body), { headers: { "content-type": contentType } }).formData();
  } catch (error) {
    throw payloadError(provider, `${provider} inbound body is not valid form data.`, error instanceof Error ? error : undefined);
  }

  const fields = new Map<string, string[]>();
  const files = new Map<string, File>();

  for (const [name, value] of form.entries()) {
    if (isStringMember(value)) {
      const list = fields.get(name);

      if (list) list.push(value);
      else fields.set(name, [value]);
    } else {
      files.set(name, value);
    }
  }

  return { fields, files };
}

export function formField(fields: InboundFormFields, name: string): string | undefined {
  const value = fields.get(name)?.[0];

  return value === undefined || value === "" ? undefined : value;
}

/** Lenient base64 for message content. A dangling sixth-bit character carries no byte and is dropped. */
export function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const alphabet = value.replace(/[^A-Za-z0-9+/_-]/g, "").replaceAll("-", "+").replaceAll("_", "/");
  const clean = alphabet.length % 4 === 1 ? alphabet.slice(0, -1) : alphabet;
  const binary = atob(clean + "=".repeat((4 - clean.length % 4) % 4));

  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

/**
 * Strict base64 for signatures and keys: malformed input throws instead of being repaired.
 * Padded input must be a whole number of quads; unpadded input cannot end on a lone sixth-bit
 * character, which `decodeBase64` would silently drop.
 */
export function decodeBase64Strict(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.includes("=");

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || (padded ? value.length % 4 !== 0 : value.length % 4 === 1)) {
    throw new Error("Malformed base64.");
  }

  const binary = atob(padded ? value : value + "=".repeat((4 - value.length % 4) % 4));

  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

export function decodeHexStrict(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[a-fA-F0-9]{2})+$/.test(value)) throw new Error("Malformed hex.");

  return Uint8Array.from(value.match(/../g) ?? [], pair => Number.parseInt(pair, 16));
}

export function encodeBase64(bytes: Uint8Array): string {
  let binary = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return btoa(binary);
}

/** Compare two byte strings without short-circuiting on the first difference. */
export function timingSafeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }

  return difference === 0;
}

export async function hmac(
  hash: "SHA-1" | "SHA-256",
  key: Uint8Array<ArrayBuffer>,
  content: Uint8Array<ArrayBuffer>,
): Promise<Uint8Array<ArrayBuffer>> {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash }, false, ["sign"]);

  return new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, content));
}

export function signingSecrets(secret: string | readonly string[]): readonly string[] {
  const keys = isStringMember(secret) ? [secret] : secret;

  if (!Array.isArray(keys)) return [];

  return keys.filter(key => isStringMember(key) && key.length > 0);
}

/** Check an epoch-seconds timestamp against the tolerance window. */
export function timestampFresh(value: string | number | undefined, options: InboundClockOptions): boolean {
  if (value === undefined || !/^(0|[1-9]\d*)$/.test(String(value))) return false;

  const timestamp = Number(value);
  const now = options.now ?? Date.now();
  const tolerance = options.toleranceSeconds ?? 300;

  return Number.isSafeInteger(timestamp) && Number.isFinite(now) && Number.isFinite(tolerance) &&
    tolerance >= 0 && Math.abs(now / 1000 - timestamp) <= tolerance;
}

export const verified: InboundVerification = { ok: true };

export function rejected(reason: Exclude<InboundVerification, { ok: true }>["reason"]): InboundVerification {
  return { ok: false, reason };
}

/** Throw the matching `InboundError` when a verification failed. */
export function assertVerified(provider: InboundProvider, result: InboundVerification): void {
  if (result.ok) return;

  const messages: Record<typeof result.reason, string> = {
    signature_missing: `${provider} inbound request has no signature.`,
    signature_invalid: `${provider} inbound signature does not match.`,
    timestamp_expired: `${provider} inbound signature timestamp is outside the tolerance window.`,
    secret_missing: `${provider} inbound verification needs a signing secret.`,
    payload_invalid: `${provider} inbound payload could not be read for verification.`,
  };

  throw new InboundError(messages[result.reason], { reason: result.reason, provider });
}

export function verdict(value: string | undefined): InboundVerdict | undefined {
  if (value === undefined) return undefined;

  const normalized = value.trim().toLowerCase().replaceAll(" ", "_");

  switch (normalized) {
    case "pass":
    case "fail":
    case "softfail":
    case "neutral":
    case "none":
    case "temperror":
    case "permerror":
    case "gray":
    case "processing_failed":
      return normalized;
    case "":
      return undefined;
    default:
      return "unknown";
  }
}

export function inlineAttachment(
  details: Omit<InboundAttachment, "read" | "content" | "size"> & { content: Uint8Array; size?: number },
): InboundAttachment {
  const content = details.content;

  return {
    ...details,
    size: details.size ?? content.byteLength,
    read: async () => content,
  };
}

export function remoteAttachment(
  details: Omit<InboundAttachment, "read" | "content">,
  read: () => Promise<Uint8Array>,
): InboundAttachment {
  return { ...details, read };
}

/**
 * Message IDs from a `Message-ID`, `In-Reply-To`, or `References` value. Comments are CFWS
 * (RFC 5322 3.6.4), so a `<id>` inside one is skipped. A value with no `<id>` falls back to
 * whitespace- or comma-separated tokens, as some providers send bare IDs. A domain literal such
 * as `[a(b)c]` or `[a>b]` is data in either form.
 */
export function messageIds(value: string | undefined): string[] {
  if (!value) return [];

  const bracketed: string[] = [];
  let bare = "";
  let depth = 0;
  let literal = false;
  let afterAt = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;

    if (depth > 0) {
      if (char === "\\") index += 1;
      else if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;

      continue;
    }

    if (literal) {
      bare += char;

      if (char === "\\") {
        bare += value[index + 1] ?? "";
        index += 1;
      } else if (char === "]") literal = false;

      continue;
    }

    if (char === "(") {
      depth = 1;
      bare += " ";
    } else if (char === "<") {
      const id = bracketedId(value, index + 1);

      // No `>` closes this one, and the scan reached the end, so no later `<` can close either.
      if (id === undefined) break;

      const text = value.slice(id.start, id.end);

      if (text && !/\s/.test(text)) bracketed.push(text);

      index = id.end;
    } else {
      // A bare ID has no CFWS inside it, so only `@[` opens its domain literal.
      if (char === "[" && afterAt) literal = true;

      bare += char;
    }

    afterAt = char === "@";
  }

  if (bracketed.length) return bracketed;

  return bare.split(/[\s,]+/).filter(Boolean);
}

interface BracketedId {
  /** Index of the first character after the last unclosed `<`. */
  start: number;
  /** Index of the closing `>`. */
  end: number;
}

/**
 * Find the `>` that closes a msg-id, skipping a `>` inside a domain literal. A later `<` restarts
 * the ID, so a run of `<` is scanned once.
 */
function bracketedId(value: string, from: number): BracketedId | undefined {
  let start = from;
  let literal = false;
  let afterAt = false;

  for (let index = from; index < value.length; index += 1) {
    const char = value[index]!;

    if (literal) {
      if (char === "\\") index += 1;
      else if (char === "]") literal = false;

      continue;
    }

    if (char === ">") return { start, end: index };

    if (char === "<") start = index + 1;
    else if (char === "[" && afterAt) literal = true;

    afterAt = char === "@";
  }

  return undefined;
}

export function firstMessageId(value: string | undefined): string | undefined {
  return messageIds(value)[0];
}

export function parseDate(value: string | number | undefined): Date | undefined {
  if (value === undefined || value === "") return undefined;

  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date;
}

export function uniqueAddresses(addresses: readonly InboundAddress[]): InboundAddress[] {
  const seen = new Set<string>();

  return addresses.filter(entry => {
    const key = entry.address.toLowerCase();

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}

export interface InboundFetchOptions {
  fetch?: typeof fetch;
  signal?: AbortSignal;
}

/** Fetch a provider resource, mapping HTTP failures to `InboundError`. */
export async function providerFetch(
  provider: InboundProvider,
  url: string | URL,
  init: RequestInit & { fetch?: typeof fetch },
): Promise<Response> {
  const { fetch: fetcher = fetch, ...request } = init;
  let response: Response;

  try {
    response = await fetcher(url, request);
  } catch (error) {
    throw new InboundError(`${provider} inbound fetch failed.`, {
      reason: "fetch_failed",
      provider,
      cause: error instanceof Error ? error : undefined,
    });
  }

  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 300);

    throw new InboundError(`${provider} inbound fetch failed with HTTP ${response.status}${detail ? `: ${detail}` : "."}`, {
      reason: "fetch_failed",
      provider,
      status: response.status,
    });
  }

  return response;
}

export async function fetchJson(
  provider: InboundProvider,
  url: string | URL,
  init: RequestInit & { fetch?: typeof fetch },
): Promise<JsonObject> {
  const response = await providerFetch(provider, url, init);
  const value = parseJsonBody(provider, await response.text());

  if (!isJsonObject(value)) throw payloadError(provider, `${provider} API returned a non-object JSON body.`);

  return value;
}

export async function fetchBytes(
  provider: InboundProvider,
  url: string | URL,
  init: RequestInit & { fetch?: typeof fetch },
): Promise<Uint8Array> {
  const response = await providerFetch(provider, url, init);

  return new Uint8Array(await response.arrayBuffer());
}

export interface InboundBasicAuthOptions {
  username: string;
  password: string;
}

/**
 * Check HTTP Basic credentials embedded in the webhook URL
 * (`https://user:pass@example.com/inbound`), for providers that do not sign inbound requests.
 */
export function verifyBasicAuth(
  headers: InboundHeadersInit | undefined,
  options: InboundBasicAuthOptions,
): InboundVerification {
  if (!options.username && !options.password) return rejected("secret_missing");

  const header = readHeader(headers, "authorization");
  const match = header ? /^Basic\s+([A-Za-z0-9+/=]+)\s*$/i.exec(header) : null;

  if (!match) return rejected("signature_missing");

  let presented: Uint8Array;

  try {
    presented = decodeBase64Strict(match[1]!);
  } catch {
    return rejected("signature_invalid");
  }

  const expected = utf8Bytes(`${options.username}:${options.password}`);

  return timingSafeEqual(presented, expected) ? verified : rejected("signature_invalid");
}

/** Compare a shared token from a header against the configured value in constant time. */
export function verifySharedToken(
  presented: string | undefined,
  secret: string | readonly string[],
): InboundVerification {
  const secrets = signingSecrets(secret);

  if (!secrets.length) return rejected("secret_missing");

  if (!presented) return rejected("signature_missing");

  const bytes = utf8Bytes(presented);
  let match = false;

  for (const candidate of secrets) match = timingSafeEqual(bytes, utf8Bytes(candidate)) || match;

  return match ? verified : rejected("signature_invalid");
}

/** Check an `Authorization: Bearer <token>` header against the configured token. */
export function verifyBearerToken(
  headers: InboundHeadersInit | undefined,
  secret: string | readonly string[],
): InboundVerification {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(readHeader(headers, "authorization") ?? "");

  return verifySharedToken(match?.[1], secret);
}

/** Verify a hex or base64 HMAC over `content` against every configured secret. */
export async function verifyHmac(
  hash: "SHA-1" | "SHA-256",
  presented: string | undefined,
  encoding: "hex" | "base64",
  secret: string | readonly string[],
  content: Uint8Array<ArrayBuffer>,
): Promise<InboundVerification> {
  const secrets = signingSecrets(secret);

  if (!secrets.length) return rejected("secret_missing");

  if (!presented) return rejected("signature_missing");

  let signature: Uint8Array;

  try {
    signature = encoding === "hex" ? decodeHexStrict(presented.trim()) : decodeBase64Strict(presented.trim());
  } catch {
    return rejected("signature_invalid");
  }

  for (const key of secrets) {
    if (timingSafeEqual(signature, await hmac(hash, utf8Bytes(key), content))) return verified;
  }

  return rejected("signature_invalid");
}

/** Parse a `t=<unix>,v1=<hex>[,v1=<hex>]` signature header. */
export interface TimestampedSignature {
  timestamp?: string;
  signatures: string[];
}

export function parseTimestampedSignature(header: string | undefined): TimestampedSignature {
  const signatures: string[] = [];
  let timestamp: string | undefined;

  for (const part of (header ?? "").split(",")) {
    const [key, ...rest] = part.trim().split("=");
    const value = rest.join("=");

    if (key === "t") timestamp = value;
    else if (key === "v1" && value) signatures.push(value);
  }

  return { timestamp, signatures };
}

/** Concatenate byte arrays. */
export function concatBytes(...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

/** Verify a `t=…,v1=…` HMAC-SHA256 hex header over `<t>.<raw body>` (Lettermint, Primitive). */
export async function verifyTimestampedHmac(
  header: string | undefined,
  body: string | Uint8Array,
  options: InboundSignatureOptions,
): Promise<InboundVerification> {
  if (!signingSecrets(options.secret).length) return rejected("secret_missing");

  const { timestamp, signatures } = parseTimestampedSignature(header);

  if (!timestamp || !signatures.length) return rejected("signature_missing");

  if (!timestampFresh(timestamp, options)) return rejected("timestamp_expired");

  const content = concatBytes(utf8Bytes(`${timestamp}.`), toBytes(body));

  for (const signature of signatures) {
    const result = await verifyHmac("SHA-256", signature, "hex", options.secret, content);

    if (result.ok || result.reason !== "signature_invalid") return result;
  }

  return rejected("signature_invalid");
}
