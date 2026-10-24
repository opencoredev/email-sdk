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
  /** Names of RFC 2231 parameters, whose values are already decoded text. */
  extended: Set<string>;
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

  return { headers: parseHeaderBlock(headerBlock, headerText), body, source };
}

/**
 * Split a header block into unfolded fields. `decodeValue` turns each value into text: raw MIME
 * passes `headerText`, since its values are still one char per byte.
 */
function parseHeaderBlock(block: string, decodeValue: (value: string) => string): InboundHeader[] {
  const headers: InboundHeader[] = [];

  for (const line of block.replace(/\r?\n(?=[ \t])/g, "").split(/\r?\n/)) {
    const colon = line.indexOf(":");

    if (colon <= 0) continue;

    const name = line.slice(0, colon).trim();

    if (!/^[!-9;-~]+$/.test(name)) continue;

    // Only ASCII whitespace: a raw MIME value is still one char per byte, and `.trim()` would also
    // eat 0x85 and 0xA0, which are continuation bytes of raw UTF-8 such as `à` (C3 A0).
    headers.push({ name, value: decodeValue(trimHeaderWhitespace(line.slice(colon + 1))) });
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

function trimHeaderWhitespace(value: string): string {
  let start = 0;

  while (start < value.length && (value[start] === " " || value[start] === "\t")) start += 1;

  return trimLineEnd(value.slice(start));
}

/** Drop trailing spaces and tabs with a plain scan; a regex here backtracks quadratically on long runs. */
function trimLineEnd(line: string): string {
  let end = line.length;

  while (end > 0 && (line[end - 1] === " " || line[end - 1] === "\t")) end -= 1;

  return line.slice(0, end);
}

function decodeQuotedPrintable(body: string): Uint8Array {
  const lines = body.split("\n").map(line => line.endsWith("\r") ? `${trimLineEnd(line.slice(0, -1))}\r` : trimLineEnd(line));

  // The last line has no line break after it, so its trailing whitespace is content.
  lines[lines.length - 1] = body.slice(body.lastIndexOf("\n") + 1);

  return binaryBytes(decodeQuotedPrintableText(lines.join("\n").replace(/=\r?\n/g, "")));
}

function decodeTransfer(body: string, encoding: string | undefined): Uint8Array {
  switch (splitParams(encoding ?? "")[0]?.toLowerCase()) {
    case "base64":
      return decodeBase64(body);
    case "quoted-printable":
      return decodeQuotedPrintable(body);
    default:
      return binaryBytes(body);
  }
}

/** Index just past the RFC 822 comment that opens at `start`, honoring nesting and `\\` escapes. */
function commentEnd(value: string, start: number): number {
  let depth = 0;

  for (let index = start; index < value.length; index += 1) {
    const char = value[index];

    if (char === "\\") index += 1;
    else if (char === "(") depth += 1;
    else if (char === ")" && --depth === 0) return index + 1;
  }

  return value.length;
}

interface CommentRun {
  /** Index of the first character after the run. */
  end: number;
  /** A `;` or the end of the value follows the run, so it is a removable comment. */
  trailing: boolean;
}

/** Skip a run of comments and whitespace. */
function commentRun(value: string, start: number): CommentRun {
  let index = start;

  while (index < value.length) {
    const char = value[index];

    if (char === ";") return { end: index, trailing: true };

    if (char === "(") index = commentEnd(value, index);
    else if (char === " " || char === "\t") index += 1;
    else return { end: index, trailing: false };
  }

  return { end: index, trailing: true };
}

/**
 * Split a structured header value on `;`, respecting quoted strings and dropping RFC 822
 * comments such as `boundary=b (generated)`. A parenthesis followed by more token text, as in
 * the unquoted `filename=scan (1).pdf` some mailers send, is kept as literal text.
 */
function splitParams(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;

    if (char === "(" && !quoted) {
      // Consume the whole run at once so a long chain of comments is scanned only once.
      const run = commentRun(value, index);

      if (current.trim() !== "" && !run.trailing) current += value.slice(index, run.end);

      index = run.end - 1;
    } else if (char === "\\" && quoted) {
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

const utf8 = new TextEncoder();

/**
 * Append the bytes of an RFC 2231 encoded value: `%XX` is one byte, and any other character is
 * its UTF-8 encoding, so stray non-ASCII text is not truncated to its low byte.
 */
function appendPercentBytes(bytes: number[], value: string): void {
  let literal = "";

  for (let index = 0; index < value.length; index += 1) {
    const hex = value[index] === "%" ? value.slice(index + 1, index + 3) : "";

    if (/^[0-9A-Fa-f]{2}$/.test(hex)) {
      for (const byte of utf8.encode(literal)) bytes.push(byte);

      literal = "";
      bytes.push(Number.parseInt(hex, 16));
      index += 2;
    } else {
      literal += value[index];
    }
  }

  for (const byte of utf8.encode(literal)) bytes.push(byte);
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
    let decoded = "";
    // Consecutive encoded pieces decode together, since a multi-byte character may span them.
    let bytes: number[] = [];

    const flush = () => {
      if (bytes.length) decoded += decodeCharset(Uint8Array.from(bytes), charset);

      bytes = [];
    };

    for (const [position, piece] of pieces.entries()) {
      let text = piece.value;

      if (!piece.encoded) {
        // An unencoded piece is already text; it must not pass through a byte conversion.
        flush();
        decoded += text;
        continue;
      }

      if (position === 0) {
        const parts = /^([^']*)'[^']*'(.*)$/.exec(text);

        if (parts) {
          charset = parts[1] || charset;
          text = parts[2] ?? "";
        }
      }

      appendPercentBytes(bytes, text);
    }

    flush();
    params.set(name, decoded);
  }

  return { type: head.toLowerCase(), params, extended: new Set(extended.keys()) };
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
    const trimmed = trimLineEnd(line.replace(/\r?\n$/, ""));

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

  // No closing delimiter owns the final line break, so an unterminated last part keeps its bytes.
  if (current?.length) parts.push(current.join(""));

  return parts;
}

/**
 * A filename parameter as text. Many mailers put RFC 2047 encoded words in a plain quoted value,
 * so those decode; an RFC 2231 value is already decoded and must not be decoded again.
 */
function filenameOf(header: ContentType, param: string): string | undefined {
  const value = header.params.get(param);

  if (value === undefined || header.extended.has(param)) return value;

  return decodeEncodedWords(value);
}

function contentIdOf(headers: readonly InboundHeader[]): string | undefined {
  return headerValue(headers, "content-id")?.trim().replace(/^<|>$/g, "") || undefined;
}

/**
 * Walk one entity. A `resource` is a non-root part of `multipart/related` (RFC 2387), such as an
 * image or stylesheet the root references by `cid:`; it is always kept as an attachment.
 */
function walk(entity: MimeEntity, state: WalkState, depth: number, defaultType = "text/plain", resource = false): void {
  state.parts += 1;

  if (state.parts > MAX_PARTS || depth > MAX_DEPTH) return;

  const contentType = parseStructuredHeader(headerValue(entity.headers, "content-type") ?? defaultType);
  const type = contentType.type || defaultType;
  const disposition = parseStructuredHeader(headerValue(entity.headers, "content-disposition"));
  const boundary = contentType.params.get("boundary");

  const filename = filenameOf(disposition, "filename") ?? filenameOf(contentType, "name");
  const isAttachment = disposition.type === "attachment";

  if (type.startsWith("multipart/") && boundary && !isAttachment && !resource) {
    const childDefault = type === "multipart/digest" ? "message/rfc822" : "text/plain";
    const parts = multipartBodies(entity.body, boundary);

    if (type === "multipart/related") {
      // The root is the part named by `start`, or the first part; the rest are its resources.
      const children = parts.map(splitEntity);
      const start = contentType.params.get("start")?.trim().replace(/^<|>$/g, "");
      const named = start ? children.findIndex(child => contentIdOf(child.headers) === start) : -1;
      const root = named === -1 ? 0 : named;

      for (const [index, child] of children.entries()) walk(child, state, depth + 1, childDefault, index !== root);

      return;
    }

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

  const isBodyText = (type === "text/plain" || type === "text/html") && !isAttachment && !resource && filename === undefined;

  if (isBodyText) {
    if (!bytes.length) return;

    const text = decodeCharset(bytes, contentType.params.get("charset"));

    if (type === "text/html") state.html.push(text);
    else state.text.push(text);

    return;
  }

  const contentId = contentIdOf(entity.headers);

  state.attachments.push(inlineAttachment({
    filename,
    contentType: type,
    contentId,
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

/**
 * Read a header block that is already decoded text, such as SendGrid's parsed-mode `headers`
 * field. Values are not re-decoded as bytes, so `Â£` stays `Â£`; RFC 2047 words still decode.
 */
export function parseMimeHeaders(text: string): ParsedMimeHeaders {
  return headerViews(parseHeaderBlock(text, value => value));
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
      const end = closingAngle(entry, index + 1);

      return end === -1 ? undefined : { start: index, address: entry.slice(index + 1, end) };
    }
  }

  return undefined;
}

/**
 * Index of the `>` that closes an angle address. A `>` in a quoted local part (`"a>b"@x`), a
 * comment (`a(note > x)@x`), or a domain literal (`a@[x>y]`) does not close it.
 */
function closingAngle(entry: string, from: number): number {
  let quoted = false;
  let comment = 0;
  let literal = false;

  for (let index = from; index < entry.length; index += 1) {
    const char = entry[index]!;

    if (char === "\\" && (quoted || comment || literal)) index += 1;
    else if (literal) literal = char !== "]";
    else if (char === "\"" && !comment) quoted = !quoted;
    else if (!quoted && char === "(") comment += 1;
    else if (!quoted && char === ")" && comment) comment -= 1;
    else if (!quoted && !comment && char === "[" && entry[index - 1] === "@") literal = true;
    else if (!quoted && !comment && char === ">") return index;
  }

  return -1;
}

/** Tokenize an address list, respecting quotes, comments, angle brackets, and groups. */
function splitAddressList(value: string): string[] {
  const entries: string[] = [];
  let current = "";
  let quoted = false;
  let angle = 0;
  let comment = 0;
  // Inside a domain literal such as `[IPv6:2001:db8::1]`, colons are part of the address.
  let literal = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;

    if (char === "\\" && (quoted || comment || literal)) {
      current += char + (value[index + 1] ?? "");
      index += 1;
      continue;
    }

    if (literal) {
      if (char === "]") literal = false;
    } else if (char === "\"" && !comment) quoted = !quoted;
    else if (!quoted && char === "(") comment += 1;
    else if (!quoted && char === ")" && comment) comment -= 1;
    else if (!quoted && !comment && char === "[" && value[index - 1] === "@") literal = true;
    else if (!quoted && !comment && char === "<") angle += 1;
    else if (!quoted && !comment && char === ">" && angle) angle -= 1;

    if (!quoted && !comment && !angle && !literal && (char === "," || char === ";")) {
      entries.push(current);
      current = "";
      continue;
    }

    if (!quoted && !comment && !angle && !literal && char === ":") {
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

/**
 * Drop comments and collapse whitespace outside quoted strings, keeping the first comment's text.
 * Quoted strings pass through verbatim, so `"a(b)"@x` and `"a  b"@x` keep their local parts.
 * Each run of comments and whitespace becomes `separator`: a space in display names, nothing
 * in an addr-spec, where CFWS around `@` and `.` carries no meaning.
 */
function stripComments(value: string, separator = " "): CommentedText {
  let text = "";
  let comment: string | undefined;
  let commentText = "";
  let depth = 0;
  let quoted = false;
  // Whitespace outside quotes is buffered so a run of it (or a comment) becomes one space.
  let pendingSpace = false;

  const append = (chars: string) => {
    if (pendingSpace && text) text += separator;

    pendingSpace = false;
    text += chars;
  };

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;
    const escaped = char === "\\" ? char + (value[index + 1] ?? "") : undefined;

    if (escaped !== undefined && (quoted || depth > 0)) index += 1;

    if (depth > 0) {
      if (escaped !== undefined) commentText += escaped.slice(1);
      else if (char === "(") depth += 1;
      else if (char === ")") depth -= 1;

      if (depth === 0) {
        comment ??= commentText.trim();
        pendingSpace = true;
      } else if (escaped === undefined) commentText += char;
    } else if (quoted) {
      text += escaped ?? char;

      if (char === "\"") quoted = false;
    } else if (char === "(") {
      depth = 1;
      commentText = "";
    } else if (/\s/.test(char)) {
      pendingSpace = true;
    } else {
      append(char);

      if (char === "\"") quoted = true;
    }
  }

  return { text, comment };
}

/** Parse `"Ada, L." <ada@example.com>, bob@example.com` into addresses. */
export function parseAddressList(value: string | undefined): InboundAddress[] {
  if (!value) return [];

  const addresses: InboundAddress[] = [];

  for (const entry of splitAddressList(value)) {
    const angle = angleAddress(entry);

    if (angle) {
      const address = stripComments(angle.address, "").text.replace(/^mailto:/i, "");
      const name = decodeEncodedWords(unquote(stripComments(entry.slice(0, angle.start)).text));

      if (address.includes("@")) addresses.push(name ? { address, name } : { address });

      continue;
    }

    const { text, comment } = stripComments(entry, "");

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
