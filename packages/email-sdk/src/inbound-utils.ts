import { createHmac, createPublicKey, timingSafeEqual, verify as nodeVerify } from "node:crypto";

import type {
  InboundEmailAddress,
  InboundEmailAttachment,
  InboundEmailAdapter,
} from "./inbound-types.js";

export type ParsedInboundInput = {
  payload: unknown;
  rawBody?: string;
  headers: Headers;
};

export async function parseInboundInput(input: Request | unknown): Promise<ParsedInboundInput> {
  if (input instanceof Request) {
    const request = input.clone();
    const headers = new Headers(request.headers);
    const contentType = headers.get("content-type") ?? "";
    const rawBody = await request.text();

    if (contentType.includes("application/json")) {
      return { payload: rawBody ? JSON.parse(rawBody) : {}, rawBody, headers };
    }

    if (
      contentType.includes("application/x-www-form-urlencoded") ||
      contentType.includes("multipart/form-data")
    ) {
      const form = await input.clone().formData();
      return { payload: formDataToRecord(form), rawBody, headers };
    }

    return { payload: rawBody, rawBody, headers };
  }

  return { payload: input, headers: new Headers() };
}

export function formDataToRecord(form: FormData): Record<string, unknown> {
  const record: Record<string, unknown> = {};

  for (const [key, value] of form.entries()) {
    if (key in record) {
      const current = record[key];
      record[key] = Array.isArray(current) ? [...current, value] : [current, value];
      continue;
    }

    record[key] = value;
  }

  return record;
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  return {};
}

export function stringValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return undefined;
}

export function arrayValue(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    return [value];
  }

  return [];
}

export function firstString(record: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = record[key];
    const string = stringValue(value);

    if (string !== undefined) {
      return string;
    }

    if (Array.isArray(value)) {
      const nested = value.map(stringValue).find((item): item is string => item !== undefined);

      if (nested !== undefined) {
        return nested;
      }
    }
  }

  return undefined;
}

export function parseAddress(value: unknown): InboundEmailAddress | undefined {
  if (!value) {
    return undefined;
  }

  if (typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const email =
      stringValue(record.email) ??
      stringValue(record.Email) ??
      stringValue(record.MailboxHash) ??
      stringValue(record.address);

    if (!email) {
      return undefined;
    }

    const name = stringValue(record.name) ?? stringValue(record.Name);
    return name ? { email, name } : { email };
  }

  const raw = stringValue(value)?.trim();

  if (!raw) {
    return undefined;
  }

  const match = raw.match(/^(?:"?([^"<]*)"?)?\s*<([^>]+)>$/);

  if (!match) {
    return { email: raw };
  }

  const name = match[1]?.trim();
  const email = match[2]?.trim();

  if (!email) {
    return undefined;
  }

  return name ? { email, name } : { email };
}

export function parseAddressList(value: unknown): InboundEmailAddress[] {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .flatMap((item) => parseAddressList(item))
      .filter((address): address is InboundEmailAddress => Boolean(address.email));
  }

  if (typeof value === "object") {
    const address = parseAddress(value);
    return address ? [address] : [];
  }

  const raw = stringValue(value);

  if (!raw) {
    return [];
  }

  return splitAddressList(raw)
    .map(parseAddress)
    .filter((address): address is InboundEmailAddress => Boolean(address));
}

export function splitAddressList(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let quoted = false;

  for (const char of value) {
    if (char === '"') {
      quoted = !quoted;
    }

    if (!quoted && char === "<") {
      depth += 1;
    }

    if (!quoted && char === ">") {
      depth = Math.max(0, depth - 1);
    }

    if (!quoted && depth === 0 && char === ",") {
      if (current.trim()) {
        parts.push(current.trim());
      }

      current = "";
      continue;
    }

    current += char;
  }

  if (current.trim()) {
    parts.push(current.trim());
  }

  return parts;
}

export function parseHeaders(value: unknown): Record<string, string> {
  if (!value) {
    return {};
  }

  if (typeof value === "string") {
    const trimmed = value.trim();

    if (!trimmed) {
      return {};
    }

    try {
      return parseHeaders(JSON.parse(trimmed));
    } catch {
      return parseHeaderLines(trimmed);
    }
  }

  if (Array.isArray(value)) {
    const headers: Record<string, string> = {};

    for (const item of value) {
      if (Array.isArray(item)) {
        const [name, headerValue] = item;
        addHeader(headers, stringValue(name), stringValue(headerValue));
        continue;
      }

      if (item && typeof item === "object") {
        const record = item as Record<string, unknown>;
        addHeader(
          headers,
          stringValue(record.name) ?? stringValue(record.Name),
          stringValue(record.value) ?? stringValue(record.Value),
        );
      }
    }

    return headers;
  }

  if (typeof value === "object") {
    const headers: Record<string, string> = {};

    for (const [name, headerValue] of Object.entries(value)) {
      addHeader(headers, name, stringValue(headerValue));
    }

    return headers;
  }

  return {};
}

export function parseReferences(value: unknown): string[] | undefined {
  const raw = stringValue(value);

  if (!raw) {
    return undefined;
  }

  const references = raw.match(/<[^>]+>|\S+/g);
  return references?.length ? references : undefined;
}

export function normalizeAttachments(value: unknown): InboundEmailAttachment[] {
  return arrayValue(value)
    .map((item) => {
      if (item instanceof File) {
        return {
          filename: item.name,
          contentType: item.type || undefined,
          size: item.size,
          content: item,
          raw: item,
        };
      }

      const record = asRecord(item);
      const filename =
        firstString(record, ["filename", "Filename", "Name", "name"]) ??
        firstString(record, ["ContentID", "contentId"]);

      return {
        filename,
        contentType: firstString(record, ["contentType", "ContentType", "content_type", "type"]),
        contentId: firstString(record, ["contentId", "ContentID", "cid"]),
        disposition: normalizeDisposition(
          firstString(record, ["disposition", "ContentDisposition"]),
        ),
        size: numberValue(record.size ?? record.Size ?? record.ContentLength),
        content: (record.content ?? record.Content ?? record.Data) as
          | string
          | Uint8Array
          | ArrayBuffer
          | Blob
          | undefined,
        url: firstString(record, ["url", "Url", "downloadUrl", "download_url"]),
        raw: item,
      } satisfies InboundEmailAttachment;
    })
    .filter((attachment) => Boolean(attachment.filename ?? attachment.url ?? attachment.content));
}

export function hmacSha256Hex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value).digest("hex");
}

export function hmacSha256Base64(secret: string | Uint8Array, value: string): string {
  return createHmac("sha256", secret).update(value).digest("base64");
}

export function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  if (left.length !== right.length) {
    return false;
  }

  return timingSafeEqual(left, right);
}

export function verifyMailgunSignature(input: {
  signingKey: string;
  timestamp?: string;
  token?: string;
  signature?: string;
}): boolean {
  if (!input.timestamp || !input.token || !input.signature) {
    return false;
  }

  const expected = hmacSha256Hex(input.signingKey, `${input.timestamp}${input.token}`);
  return constantTimeEqual(expected, input.signature);
}

export function verifySvixSignature(input: {
  secret: string;
  id?: string | null;
  timestamp?: string | null;
  signature?: string | null;
  payload?: string;
}): boolean {
  if (!input.id || !input.timestamp || !input.signature || input.payload === undefined) {
    return false;
  }

  const secret = input.secret.startsWith("whsec_")
    ? Buffer.from(input.secret.slice("whsec_".length), "base64")
    : input.secret;
  const signedContent = `${input.id}.${input.timestamp}.${input.payload}`;
  const signatures = input.signature
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      if (part.startsWith("v1,") || part.startsWith("v1=")) {
        return part.slice(3);
      }

      return part;
    });
  const expected = hmacSha256Base64(secret, signedContent);

  return signatures.some((signature) => constantTimeEqual(signature, expected));
}

export function verifySendGridEcdsaSignature(input: {
  publicKey: string;
  timestamp?: string | null;
  signature?: string | null;
  payload?: string;
}): boolean {
  if (!input.timestamp || !input.signature || input.payload === undefined) {
    return false;
  }

  try {
    const key = createPublicKey(input.publicKey);
    return nodeVerify(
      "sha256",
      Buffer.from(`${input.timestamp}${input.payload}`),
      key,
      Buffer.from(input.signature, "base64"),
    );
  } catch {
    return false;
  }
}

export function adapterWithOptionalVerify<T extends InboundEmailAdapter>(
  adapter: T,
  verify?: InboundEmailAdapter["verify"],
): T {
  if (!verify) {
    return adapter;
  }

  return { ...adapter, verify };
}

function parseHeaderLines(value: string): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const line of value.split(/\r?\n/)) {
    const index = line.indexOf(":");

    if (index <= 0) {
      continue;
    }

    addHeader(headers, line.slice(0, index).trim(), line.slice(index + 1).trim());
  }

  return headers;
}

function addHeader(headers: Record<string, string>, name?: string, value?: string) {
  if (!name || value === undefined) {
    return;
  }

  headers[name] = value;
}

function normalizeDisposition(value?: string): "attachment" | "inline" | undefined {
  if (value === "attachment" || value === "inline") {
    return value;
  }

  return undefined;
}

function numberValue(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const number = Number(value);
    return Number.isFinite(number) ? number : undefined;
  }

  return undefined;
}
