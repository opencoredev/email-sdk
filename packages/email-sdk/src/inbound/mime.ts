/**
 * A compact RFC 5322 / MIME reader for inbound mail: multipart trees, base64 and
 * quoted-printable bodies, RFC 2047 encoded words, RFC 2231 parameters, and charset
 * decoding through `TextDecoder`. It uses only web-standard APIs so it runs on Node,
 * Bun, Workers, and Convex without a dependency.
 */
import {
  type InboundAddress,
  type InboundAttachment,
  type InboundHeader,
  InboundHeaders,
} from "./types.js";
import { decodeBase64, inlineAttachment, toBytes } from "./shared.js";

/** Limits that stop hostile messages from exhausting memory or the stack. */
const MAX_DEPTH = 32;

const MAX_PARTS = 2000;

export interface ParsedMimeHeaders {
  /** Header values with RFC 2047 encoded words decoded, for display. */
  headers: InboundHeaders;
  /** Header values as sent. Parse structured headers such as addresses from these. */
  rawHeaders: InboundHeaders;
}

export interface ParsedMimeMessage extends ParsedMimeHeaders {
  text?: string;
  html?: string;
  attachments: InboundAttachment[];
}

interface MimeEntity {
  headers: InboundHeader[];
  body: string;
  source: string;
}

interface ContentType {
  type: string;
  params: Map<string, string>;
}

interface WalkState {
  parts: number;
  text: string[];
  html: string[];
  attachments: InboundAttachment[];
}

/** Bytes to a string with one char per byte, so binary content survives splitting. */
function binaryString(bytes: Uint8Array): string {
  let result = "";

  for (let index = 0; index < bytes.length; index += 0x8000) {
    result += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }

  return result;
}

function binaryBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);

  for (let index = 0; index < value.length; index += 1) bytes[index] = value.charCodeAt(index) & 0xff;

  return bytes;
}

/** Decode bytes in a charset, falling back to UTF-8 and then Latin-1 for unknown labels. */
export function decodeCharset(bytes: Uint8Array, charset: string | undefined): string {
  const label = (charset ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");

  if (label === "us-ascii" || label === "ascii") return decodeCharset(bytes, "utf-8");

  try {
    return new TextDecoder(label).decode(bytes);
  } catch {
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return binaryString(bytes);
    }
  }
}

/** Header text is usually ASCII but RFC 6532 allows raw UTF-8. */
function headerText(value: string): string {
  if (!/[\x80-\xff]/.test(value)) return value;

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(binaryBytes(value));
  } catch {
    return value;
  }
}

function splitEntity(source: string): MimeEntity {
  // A part may have no headers at all, in which case it starts with the blank line.
  const leading = /^\r?\n/.exec(source);

  if (leading) return { headers: [], body: source.slice(leading[0].length), source };

  const match = /\r?\n\r?\n/.exec(source);
  const headerBlock = match ? source.slice(0, match.index) : source;
  const body = match ? source.slice(match.index + match[0].length) : "";

  return { headers: parseHeaderBlock(headerBlock), body, source };
}

function parseHeaderBlock(block: string): InboundHeader[] {
  const headers: InboundHeader[] = [];

  for (const line of block.replace(/\r?\n(?=[ \t])/g, "").split(/\r?\n/)) {
    const colon = line.indexOf(":");

    if (colon <= 0) continue;

    const name = line.slice(0, colon).trim();

    if (!/^[!-9;-~]+$/.test(name)) continue;

    headers.push({ name, value: headerText(line.slice(colon + 1).trim()) });
  }

  return headers;
}

/** Decode RFC 2047 encoded words such as `=?UTF-8?B?w6k=?=`. */
export function decodeEncodedWords(value: string): string {
  const word = /=\?([^?\s]+)\?([BbQq])\?([^?\s]*)\?=/g;

  return value
    .replace(/(=\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)\s+(?==\?[^?\s]+\?[BbQq]\?[^?\s]*\?=)/g, "$1")
    .replace(word, (whole, charset: string, encoding: string, text: string) => {
      try {
        const bytes = encoding.toUpperCase() === "B"
          ? decodeBase64(text)
          : binaryBytes(decodeQuotedPrintableText(text.replaceAll("_", " ")));

        return decodeCharset(bytes, charset.split("*")[0]);
      } catch {
        return whole;
      }
    });
}

function decodeQuotedPrintableText(value: string): string {
  return value.replace(/=([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
}

function decodeQuotedPrintable(body: string): Uint8Array {
  return binaryBytes(decodeQuotedPrintableText(body.replace(/[ \t]+(?=\r?\n)/g, "").replace(/=\r?\n/g, "")));
}

function decodeTransfer(body: string, encoding: string | undefined): Uint8Array {
  switch (encoding?.trim().toLowerCase()) {
    case "base64":
      return decodeBase64(body);
    case "quoted-printable":
      return decodeQuotedPrintable(body);
    default:
      return binaryBytes(body);
  }
}

/** Split a structured header value on `;`, respecting quoted strings. */
function splitParams(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;

    if (char === "\\" && quoted) {
      current += char + (value[index + 1] ?? "");
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
      current += char;
    } else if (char === ";" && !quoted) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  parts.push(current);

  return parts.flatMap(part => part.trim() || []);
}

function unquote(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length >= 2 && trimmed.startsWith("\"") && trimmed.endsWith("\"")) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, "$1");
  }

  return trimmed;
}

/** Parse `type/subtype; a=b; filename*=UTF-8''%C3%A9`, including RFC 2231 continuations. */
export function parseStructuredHeader(value: string | undefined): ContentType {
  const [head = "", ...rest] = splitParams(value ?? "");
  const params = new Map<string, string>();
  const extended = new Map<string, { index: number; value: string; encoded: boolean }[]>();

  for (const part of rest) {
    const equals = part.indexOf("=");

    if (equals <= 0) continue;

    const rawName = part.slice(0, equals).trim().toLowerCase();
    const rawValue = unquote(part.slice(equals + 1));
    const match = /^([^*]+)(?:\*(\d+))?(\*)?$/.exec(rawName);

    if (!match) continue;

    const [, name = "", index, star] = match;

    if (index === undefined && star === undefined) {
      params.set(name, rawValue);
      continue;
    }

    const list = extended.get(name) ?? [];
    list.push({ index: Number(index ?? 0), value: rawValue, encoded: star !== undefined });
    extended.set(name, list);
  }

  for (const [name, pieces] of extended) {
    pieces.sort((left, right) => left.index - right.index);
    let charset = "utf-8";
    let bytes = "";

    for (const [position, piece] of pieces.entries()) {
      let text = piece.value;

      if (piece.encoded && position === 0) {
        const parts = /^([^']*)'[^']*'(.*)$/.exec(text);

        if (parts) {
          charset = parts[1] || charset;
          text = parts[2] ?? "";
        }
      }

      bytes += piece.encoded
        ? text.replace(/%([0-9A-Fa-f]{2})/g, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
        : text;
    }

    params.set(name, decodeCharset(binaryBytes(bytes), charset));
  }

  return { type: head.toLowerCase(), params };
}

function headerValue(headers: readonly InboundHeader[], name: string): string | undefined {
  const key = name.toLowerCase();

  return headers.find(header => header.name.toLowerCase() === key)?.value;
}

function multipartBodies(body: string, boundary: string): string[] {
  const delimiter = `--${boundary}`;
  const parts: string[] = [];
  const lines = body.split(/(?<=\n)/);
  let current: string[] | undefined;

  for (const line of lines) {
    const trimmed = line.replace(/\r?\n$/, "").replace(/[ \t]+$/, "");

    if (trimmed === `${delimiter}--`) {
      if (current) parts.push(current.join("").replace(/\r?\n$/, ""));
      current = undefined;
      break;
    }

    if (trimmed === delimiter) {
      if (current) parts.push(current.join("").replace(/\r?\n$/, ""));
      current = [];
      continue;
    }

    current?.push(line);
  }

  if (current?.length) parts.push(current.join("").replace(/\r?\n$/, ""));

  return parts;
}

function walk(entity: MimeEntity, state: WalkState, depth: number, defaultType = "text/plain"): void {
  state.parts += 1;

  if (state.parts > MAX_PARTS || depth > MAX_DEPTH) return;

  const contentType = parseStructuredHeader(headerValue(entity.headers, "content-type") ?? defaultType);
  const type = contentType.type || defaultType;
  const disposition = parseStructuredHeader(headerValue(entity.headers, "content-disposition"));
  const boundary = contentType.params.get("boundary");

  const rawName = disposition.params.get("filename") ?? contentType.params.get("name");
  const filename = rawName === undefined ? undefined : decodeEncodedWords(rawName);
  const isAttachment = disposition.type === "attachment";

  if (type.startsWith("multipart/") && boundary && !isAttachment) {
    const childDefault = type === "multipart/digest" ? "message/rfc822" : "text/plain";
    const parts = multipartBodies(entity.body, boundary);

    if (type !== "multipart/alternative") {
      for (const part of parts) walk(splitEntity(part), state, depth + 1, childDefault);

      return;
    }

    // Alternatives are the same content in different forms. Walk each one whole, then keep
    // the last (preferred) alternative that has text and the last that has HTML.
    let text: string[] = [];
    let html: string[] = [];

    for (const part of parts) {
      const alternative: WalkState = { parts: state.parts, text: [], html: [], attachments: state.attachments };
      walk(splitEntity(part), alternative, depth + 1, childDefault);
      state.parts = alternative.parts;

      if (alternative.text.length) text = alternative.text;

      if (alternative.html.length) html = alternative.html;
    }

    state.text.push(...text);
    state.html.push(...html);

    return;
  }

  // An attached multipart entity is kept whole, headers included.
  const bytes = type.startsWith("multipart/")
    ? binaryBytes(entity.source)
    : decodeTransfer(entity.body, headerValue(entity.headers, "content-transfer-encoding"));

  const isBodyText = (type === "text/plain" || type === "text/html") && !isAttachment && filename === undefined;

  if (isBodyText) {
    if (!bytes.length) return;

    const text = decodeCharset(bytes, contentType.params.get("charset"));

    if (type === "text/html") state.html.push(text);
    else state.text.push(text);

    return;
  }

  const contentId = headerValue(entity.headers, "content-id")?.replace(/^<|>$/g, "");

  state.attachments.push(inlineAttachment({
    filename,
    contentType: type,
    contentId: contentId || undefined,
    disposition: isAttachment ? "attachment" : disposition.type === "inline" || contentId ? "inline" : "attachment",
    content: bytes,
  }));
}

/** Parse a raw RFC 5322 message into headers, bodies, and attachments. */
export function parseMimeMessage(raw: string | Uint8Array): ParsedMimeMessage {
  const entity = splitEntity(binaryString(toBytes(raw)));
  const state: WalkState = { parts: 0, text: [], html: [], attachments: [] };
  walk(entity, state, 0);

  return {
    ...headerViews(entity.headers),
    text: state.text.length ? state.text.join("\n") : undefined,
    html: state.html.length ? state.html.join("\n") : undefined,
    attachments: state.attachments,
  };
}

function headerViews(entries: readonly InboundHeader[]): ParsedMimeHeaders {
  return {
    headers: new InboundHeaders(entries.map(header => ({ name: header.name, value: decodeEncodedWords(header.value) }))),
    rawHeaders: new InboundHeaders(entries),
  };
}

/** Read the header block of a raw message without decoding its bodies. */
export function parseMimeHeaders(raw: string): ParsedMimeHeaders {
  return headerViews(parseHeaderBlock(raw));
}

interface AngleAddress {
  start: number;
  address: string;
}

/** Find the `<addr-spec>` outside quoted strings and comments, so a quoted name cannot supply it. */
function angleAddress(entry: string): AngleAddress | undefined {
  let quoted = false;
  let comment = 0;

  for (let index = 0; index < entry.length; index += 1) {
    const char = entry[index]!;

    if (char === "\\" && (quoted || comment)) index += 1;
    else if (char === "\"" && !comment) quoted = !quoted;
    else if (!quoted && char === "(") comment += 1;
    else if (!quoted && char === ")" && comment) comment -= 1;
    else if (!quoted && !comment && char === "<") {
      const end = entry.indexOf(">", index + 1);

      return end === -1 ? undefined : { start: index, address: entry.slice(index + 1, end) };
    }
  }

  return undefined;
}

/** Tokenize an address list, respecting quotes, comments, angle brackets, and groups. */
function splitAddressList(value: string): string[] {
  const entries: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  let comment = 0;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;

    if (char === "\\" && (quoted || comment)) {
      current += char + (value[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (char === "\"" && !comment) quoted = !quoted;
    else if (!quoted && char === "(") comment += 1;
    else if (!quoted && char === ")" && comment) comment -= 1;
    else if (!quoted && !comment && char === "<") angle += 1;
    else if (!quoted && !comment && char === ">" && angle) angle -= 1;

    if (!quoted && !comment && !angle && (char === "," || char === ";")) {
      entries.push(current);
      current = "";
      continue;
    }

    if (!quoted && !comment && !angle && char === ":") {
      // A group name ("Team: a@x, b@y;") is a label, not an address.
      current = "";
      continue;
    }

    current += char;
  }

  entries.push(current);

  return entries.flatMap(entry => entry.trim() || []);
}

interface CommentedText {
  text: string;
  comment?: string;
}

function stripComments(value: string): CommentedText {
  let comment: string | undefined;

  const text = value.replace(/\(((?:\\.|[^()\\])*)\)/g, (_match, inner: string) => {
    comment ??= inner.trim();

    return " ";
  });

  return { text: text.replace(/\s+/g, " ").trim(), comment };
}

/** Parse `"Ada, L." <ada@example.com>, bob@example.com` into addresses. */
export function parseAddressList(value: string | undefined): InboundAddress[] {
  if (!value) return [];

  const addresses: InboundAddress[] = [];

  for (const entry of splitAddressList(value)) {
    const angle = angleAddress(entry);

    if (angle) {
      const address = angle.address.trim().replace(/^mailto:/i, "");
      const name = decodeEncodedWords(unquote(stripComments(entry.slice(0, angle.start)).text));

      if (address.includes("@")) addresses.push(name ? { address, name } : { address });

      continue;
    }

    const { text, comment } = stripComments(entry);

    if (!text.includes("@")) continue;

    const name = comment ? decodeEncodedWords(comment) : undefined;
    addresses.push(name ? { address: text, name } : { address: text });
  }

  return addresses;
}

export function parseAddress(value: string | undefined): InboundAddress | undefined {
  return parseAddressList(value)[0];
}

export interface MultipartFormPart {
  name: string;
  filename?: string;
  contentType?: string;
  bytes: Uint8Array;
}

/**
 * Read multipart/form-data parts as raw bytes. Unlike `FormData`, this keeps each field's
 * original bytes so callers can decode them in the charset the sender declared.
 */
export function parseMultipartFormData(body: string | Uint8Array, contentType: string): MultipartFormPart[] {
  const boundary = parseStructuredHeader(contentType).params.get("boundary");

  if (!boundary) return [];

  const parts: MultipartFormPart[] = [];

  for (const part of multipartBodies(binaryString(toBytes(body)), boundary)) {
    if (parts.length >= MAX_PARTS) break;

    const entity = splitEntity(part);
    const disposition = parseStructuredHeader(headerValue(entity.headers, "content-disposition"));
    const name = disposition.params.get("name");

    if (name === undefined) continue;

    parts.push({
      name,
      filename: disposition.params.get("filename"),
      contentType: headerValue(entity.headers, "content-type"),
      bytes: binaryBytes(entity.body),
    });
  }

  return parts;
}
