/**
 * A compact RFC 5322 / MIME reader for inbound mail: multipart trees, base64 and
 * quoted-printable bodies, RFC 2047 encoded words, RFC 2231 parameters, and charset
 * decoding through `TextDecoder`, with built-in tables for the single-byte charsets some
 * runtimes leave out. It uses only web-standard APIs so it runs on Node,
 * Bun, Workers, and Convex without a dependency.
 */
import {
  type InboundAddress,
  type InboundAttachment,
  type InboundHeader,
  InboundHeaders,
} from "./types.js";
import { decodeBase64, inlineAttachment, toBytes } from "./shared.js";
import { charsetLabels, singleByteUpperHalves } from "./single-byte-charsets.js";

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
  /**
   * Names of parameters that used RFC 2231 charset or percent encoding. Their values are already
   * decoded text, so they must not go through RFC 2047 decoding as well.
   */
  rfc2231Encoded: Set<string>;
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

/** Byte order marks per Unicode encoding form, each with the byte order it announces. */
const byteOrderMarks: Record<"8" | "16" | "32", [label: string, mark: number[]][]> = {
  "8": [["utf-8", [0xef, 0xbb, 0xbf]]],
  "16": [["utf-16be", [0xfe, 0xff]], ["utf-16le", [0xff, 0xfe]]],
  "32": [["utf-32be", [0x00, 0x00, 0xfe, 0xff]], ["utf-32le", [0xff, 0xfe, 0x00, 0x00]]],
};

interface MarkedBytes {
  label: string;
  bytes: Uint8Array;
  /** A byte order mark was found and removed. */
  marked: boolean;
}

/**
 * Remove a leading byte order mark that matches a UTF charset label. An unmarked `utf-16` or
 * `utf-32` label takes its byte order from the mark; other labels pass through unchanged.
 */
function withoutByteOrderMark(label: string, bytes: Uint8Array): MarkedBytes {
  const match = /^utf-?(?:(8)|(16|32)(le|be)?)$/.exec(label);

  if (!match) return { label, bytes, marked: false };

  const form = match[1] === "8" ? "8" : match[2] === "16" ? "16" : "32";
  const normalized = form === "8" ? "utf-8" : `utf-${form}${match[3] ?? ""}`;

  for (const [ordered, mark] of byteOrderMarks[form]) {
    if ((normalized === ordered || !match[3]) && mark.every((byte, index) => bytes[index] === byte)) {
      return { label: ordered, bytes: bytes.subarray(mark.length), marked: true };
    }
  }

  return { label: normalized, bytes, marked: false };
}

/** `TextDecoder` has no UTF-32, so read code points directly; bad or partial units become U+FFFD. */
function decodeUtf32(bytes: Uint8Array, bigEndian: boolean): string {
  let result = "";
  let index = 0;

  for (; index + 4 <= bytes.length; index += 4) {
    const unit = bytes.subarray(index, index + 4);
    const [high = 0, upper = 0, lower = 0, low = 0] = bigEndian ? unit : [unit[3], unit[2], unit[1], unit[0]];
    const code = ((high << 24) | (upper << 16) | (lower << 8) | low) >>> 0;

    result += code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) ? "\uFFFD" : String.fromCodePoint(code);
  }

  return index < bytes.length ? `${result}\uFFFD` : result;
}

/** WHATWG label to encoding name, so `latin2` finds its table and `utf8` its byte order mark. */
const charsetNames = new Map([...charsetLabels].flatMap(([name, labels]) => labels.split(" ").map(label => [label, name] as const)));

function charsetLabel(charset: string | undefined): string {
  const label = (charset ?? "utf-8").trim().toLowerCase().replace(/^"|"$/g, "");

  return label === "us-ascii" || label === "ascii" ? "utf-8" : (charsetNames.get(label) ?? label);
}

/**
 * Decode a WHATWG single-byte encoding from the built-in tables, or `undefined` when the encoding
 * has none. Used only when the runtime's `TextDecoder` lacks the encoding, as Bun 1.3 does.
 */
export function decodeSingleByte(bytes: Uint8Array, encoding: string): string | undefined {
  const upperHalf = singleByteUpperHalves.get(encoding);

  if (upperHalf === undefined) return undefined;

  let result = "";

  for (const byte of bytes) result += byte < 0x80 ? String.fromCharCode(byte) : upperHalf.charAt(byte - 0x80);

  return result;
}

/** Decode bytes in a charset, falling back to UTF-8 and then Latin-1 for unknown labels. */
export function decodeCharset(bytes: Uint8Array, charset: string | undefined): string {
  const unmarked = withoutByteOrderMark(charsetLabel(charset), bytes);

  return decodeUnmarked(unmarked.bytes, unmarked.label);
}

/** Decode bytes whose byte order mark, if any, is already removed. */
function decodeUnmarked(bytes: Uint8Array, label: string): string {
  // Unicode's default byte order for an unmarked UTF-32 stream is big-endian.
  if (label.startsWith("utf-32")) return decodeUtf32(bytes, label !== "utf-32le");

  try {
    // The mark is already gone, so a leading U+FEFF is text and must stay.
    return new TextDecoder(label, { ignoreBOM: true }).decode(bytes);
  } catch {
    const table = decodeSingleByte(bytes, label);

    if (table !== undefined) return table;

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

/**
 * Decode RFC 2047 encoded words such as `=?UTF-8?B?w6k=?=`. An encoded word is printable ASCII
 * without `?`, so a run holding other characters is left alone rather than truncated to bytes.
 */
export function decodeEncodedWords(value: string): string {
  const word = /=\?([!->@-~]+)\?([BbQq])\?([!->@-~]*)\?=/g;
  const run = /(?:=\?[!->@-~]+\?[BbQq]\?[!->@-~]*\?=)+/g;

  return value
    .replace(/(=\?[!->@-~]+\?[BbQq]\?[!->@-~]*\?=)\s+(?==\?[!->@-~]+\?[BbQq]\?[!->@-~]*\?=)/g, "$1")
    .replace(run, words => {
      // Adjacent words in one charset decode as one byte string: mailers split a multi-byte
      // character across words even though RFC 2047 says not to.
      let decoded = "";
      let charset: string | undefined;
      let bytes: number[] = [];

      const flush = () => {
        if (charset !== undefined) decoded += decodeUnmarked(Uint8Array.from(bytes), charset);

        charset = undefined;
        bytes = [];
      };

      for (const [whole, label = "", encoding = "", text = ""] of words.matchAll(word)) {
        const wordBytes = encodedWordBytes(encoding, text);

        if (wordBytes === undefined) {
          flush();
          decoded += whole;
          continue;
        }

        // Each word may carry its own byte order mark; joined, a later one would land mid-text.
        const unmarked = withoutByteOrderMark(charsetLabel(label.split("*")[0]), wordBytes);
        // An unmarked `utf-16` word continues the byte order an earlier marked word set.
        const inherits = !unmarked.marked && (unmarked.label === "utf-16" || unmarked.label === "utf-32") && charset?.startsWith(unmarked.label);
        const wordCharset = inherits ? charset : unmarked.label;

        if (wordCharset !== charset) flush();

        charset = wordCharset;

        for (const byte of unmarked.bytes) bytes.push(byte);
      }

      flush();

      return decoded;
    });
}

/** The bytes of one encoded word's text, or `undefined` when it is not valid B or Q text. */
function encodedWordBytes(encoding: string, text: string): Uint8Array | undefined {
  try {
    return encoding.toUpperCase() === "B"
      ? decodeBase64(text)
      : binaryBytes(decodeQuotedPrintableText(text.replaceAll("_", " ")));
  } catch {
    return undefined;
  }
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
 * comments such as `boundary=b (generated)` or `text(note)/plain`. A comment between two pieces
 * of a parameter value, as in the unquoted `filename=scan (1).pdf` some mailers send, is kept as
 * literal text; in the media type and parameter names it is always CFWS.
 */
function splitParams(value: string): string[] {
  const parts: string[] = [];
  let current = "";
  let quoted = false;
  // Tracked while scanning, so a comment never rescans the segment built so far.
  let inValue = false;
  let valueHasText = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index]!;

    if (char === "(" && !quoted) {
      // Consume the whole run at once so a long chain of comments is scanned only once.
      const run = commentRun(value, index);

      if (inValue && valueHasText && !run.trailing) current += value.slice(index, run.end);

      index = run.end - 1;
      continue;
    }

    if (char === ";" && !quoted) {
      parts.push(current);
      current = "";
      inValue = false;
      valueHasText = false;
      continue;
    }

    if (char === "\\" && quoted) {
      current += char + (value[index + 1] ?? "");
      index += 1;
    } else {
      if (char === "\"") quoted = !quoted;

      current += char;
    }

    if (inValue && char !== " " && char !== "\t") valueHasText = true;

    if (char === "=" && !quoted && parts.length > 0) inValue = true;
  }

  parts.push(current);

  // The media type is tokens only, so whitespace left by a dropped comment is CFWS there.
  return parts.flatMap((part, position) => (position === 0 ? part.replace(/[ \t]+/g, "") : part.trim()) || []);
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

  const rfc2231Encoded = new Set<string>();

  for (const [name, pieces] of extended) {
    pieces.sort((left, right) => left.index - right.index);
    let charset = "utf-8";
    let decoded = "";
    // RFC 2231 joins the sections into one value in one charset, so ASCII sections, encoded or
    // not, decode together: a Shift_JIS character or an ISO-2022-JP shift state may span them.
    let bytes: number[] = [];

    const flush = () => {
      if (bytes.length) decoded += decodeCharset(Uint8Array.from(bytes), charset);

      bytes = [];
    };

    for (const [position, piece] of pieces.entries()) {
      let text = piece.value;

      if (!piece.encoded) {
        if (!/[^\p{ASCII}]/u.test(text)) {
          for (let index = 0; index < text.length; index += 1) bytes.push(text.charCodeAt(index));
        } else {
          // Raw Unicode some mailers send is already text; it must not pass through a byte conversion.
          flush();
          decoded += text;
        }

        continue;
      }

      if (position === 0) {
        const parts = /^([^']*)'[^']*'(.*)$/.exec(text);

        if (parts) {
          charset = parts[1] || charset;
          text = parts[2] ?? "";
          rfc2231Encoded.add(name);
        }
      }

      if (text.includes("%")) rfc2231Encoded.add(name);

      appendPercentBytes(bytes, text);
    }

    flush();
    params.set(name, decoded);
  }

  return { type: head.toLowerCase(), params, rfc2231Encoded };
}

function headerValue(headers: readonly InboundHeader[], name: string): string | undefined {
  const key = name.toLowerCase();

  return headers.find(header => header.name.toLowerCase() === key)?.value;
}

/** Index where `body[start, end)` ends once one trailing line break is dropped. */
function withoutFinalLineBreak(body: string, start: number, end: number): number {
  if (end <= start || body[end - 1] !== "\n") return end;

  return end - 1 > start && body[end - 2] === "\r" ? end - 2 : end - 1;
}

/**
 * Yield the parts of a multipart body one at a time, scanning boundary lines by index. Callers
 * stop pulling when their part budget runs out, so the parts after that are never scanned.
 */
function* multipartBodies(body: string, boundary: string): Generator<string> {
  const delimiter = `--${boundary}`;
  let partStart: number | undefined;
  let lineStart = 0;

  while (lineStart < body.length) {
    const newline = body.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? body.length : newline + 1;

    if (body.startsWith(delimiter, lineStart)) {
      const rest = trimLineEnd(body.slice(lineStart + delimiter.length, withoutFinalLineBreak(body, lineStart, lineEnd)));

      if (rest === "--" || rest === "") {
        if (partStart !== undefined) yield body.slice(partStart, withoutFinalLineBreak(body, partStart, lineStart));

        if (rest === "--") return;

        partStart = lineEnd;
      }
    }

    lineStart = lineEnd;
  }

  // No closing delimiter owns the final line break, so an unterminated last part keeps its bytes.
  if (partStart !== undefined && partStart < body.length) yield body.slice(partStart);
}

/** Up to `limit` parts of a multipart body; the scan stops as soon as it has them. */
function takeParts(body: string, boundary: string, limit: number): string[] {
  const parts: string[] = [];

  if (limit <= 0) return parts;

  for (const part of multipartBodies(body, boundary)) {
    parts.push(part);

    if (parts.length >= limit) break;
  }

  return parts;
}

/**
 * A filename parameter as text. Many mailers put RFC 2047 encoded words in a plain quoted value,
 * continued or not, so those decode; a value that used RFC 2231 charset or percent encoding is
 * already decoded and must not be decoded again.
 */
function filenameOf(header: ContentType, param: string): string | undefined {
  const value = header.params.get(param);

  if (value === undefined || header.rfc2231Encoded.has(param)) return value;

  return decodeEncodedWords(value);
}

function contentIdOf(headers: readonly InboundHeader[]): string | undefined {
  return headerValue(headers, "content-id")?.trim().replace(/^<|>$/g, "") || undefined;
}

/**
 * Join the soft line breaks of `format=flowed` text (RFC 3676). A line ending in a space continues
 * on the next line of the same quote depth; one leading space is stuffing; `-- ` is a signature
 * separator and never flows. With `delsp=yes` the space before a soft break is not content. Line
 * breaks keep the form they were sent in.
 */
function unflow(text: string, delsp: boolean): string {
  const pieces: string[] = [];
  let flowed = false;
  let depth = 0;
  let lineBreak = "";

  for (let lineStart = 0; lineStart <= text.length;) {
    const newline = text.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? text.length : newline;
    const crlf = lineEnd > lineStart && text[lineEnd - 1] === "\r";
    const line = text.slice(lineStart, crlf ? lineEnd - 1 : lineEnd);
    let quotes = 0;

    while (line[quotes] === ">") quotes += 1;

    const content = line.slice(line[quotes] === " " ? quotes + 1 : quotes);
    const signature = content === "-- ";

    if (flowed && quotes === depth && !signature) {
      if (delsp) pieces[pieces.length - 1] = pieces.at(-1)!.slice(0, -1);

      pieces.push(content);
    } else {
      pieces.push(lineBreak, quotes ? line : content);
    }

    flowed = !signature && content.endsWith(" ");
    depth = quotes;
    lineBreak = crlf ? "\r\n" : "\n";

    if (newline === -1) break;

    lineStart = newline + 1;
  }

  return pieces.join("");
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

    if (type === "multipart/related") {
      // The root is the part named by `start`, or the first part; the rest are its resources.
      const children = takeParts(entity.body, boundary, MAX_PARTS - state.parts).map(splitEntity);
      const start = contentType.params.get("start")?.trim().replace(/^<|>$/g, "");
      const named = start ? children.findIndex(child => contentIdOf(child.headers) === start) : -1;
      const root = named === -1 ? 0 : named;

      for (const [index, child] of children.entries()) walk(child, state, depth + 1, childDefault, index !== root);

      return;
    }

    if (type !== "multipart/alternative") {
      for (const part of multipartBodies(entity.body, boundary)) {
        if (state.parts >= MAX_PARTS) break;

        walk(splitEntity(part), state, depth + 1, childDefault);
      }

      return;
    }

    // Alternatives are the same content in different forms. Walk each one whole, then keep
    // the last (preferred) alternative that has text and the last that has HTML.
    let text: string[] = [];
    let html: string[] = [];

    for (const part of multipartBodies(entity.body, boundary)) {
      if (state.parts >= MAX_PARTS) break;

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
    else if (contentType.params.get("format")?.toLowerCase() === "flowed") state.text.push(unflow(text, contentType.params.get("delsp")?.toLowerCase() === "yes"));
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

/**
 * Find the `<addr-spec>` outside quoted strings, comments, and domain literals, so neither a
 * quoted name nor a bare `user@[a<x@y>]` can supply it.
 */
function angleAddress(entry: string): AngleAddress | undefined {
  let quoted = false;
  let comment = 0;
  let literal = false;
  // Only CFWS has followed an `@` so far, so a `[` here opens a domain literal.
  let afterAt = false;

  for (let index = 0; index < entry.length; index += 1) {
    const char = entry[index]!;

    if (char === "\\" && (quoted || comment || literal)) index += 1;
    else if (literal) literal = char !== "]";
    else if (char === "\"" && !comment) quoted = !quoted;
    else if (!quoted && char === "(") comment += 1;
    else if (!quoted && char === ")" && comment) comment -= 1;
    else if (!quoted && !comment && char === "[" && afterAt) literal = true;
    else if (!quoted && !comment && char === "<") {
      const end = closingAngle(entry, index + 1);

      return end === -1 ? undefined : { start: index, address: entry.slice(index + 1, end) };
    }

    if (!quoted && !comment && !literal && char !== "(" && char !== ")" && char !== " " && char !== "\t") afterAt = char === "@";
  }

  return undefined;
}

/**
 * Index of the `>` that closes an angle address. A `>` in a quoted local part (`"a>b"@x`), a
 * comment (`a(note > x)@x`), or a domain literal (`a@[x>y]`, `a@ [x>y]`) does not close it.
 */
function closingAngle(entry: string, from: number): number {
  let quoted = false;
  let comment = 0;
  let literal = false;
  // Only CFWS has followed an `@` so far, so a `[` here opens a domain literal.
  let afterAt = false;

  for (let index = from; index < entry.length; index += 1) {
    const char = entry[index]!;

    if (char === "\\" && (quoted || comment || literal)) index += 1;
    else if (literal) literal = char !== "]";
    else if (char === "\"" && !comment) quoted = !quoted;
    else if (!quoted && char === "(") comment += 1;
    else if (!quoted && char === ")" && comment) comment -= 1;
    else if (!quoted && !comment && char === "[" && afterAt) literal = true;
    else if (!quoted && !comment && char === ">") return index;

    if (!quoted && !comment && !literal && char !== "(" && char !== ")" && char !== " " && char !== "\t") afterAt = char === "@";
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
  // Only CFWS has followed an `@` so far, so a `[` here opens a domain literal.
  let afterAt = false;

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
    else if (!quoted && !comment && char === "[" && afterAt) literal = true;
    else if (!quoted && !comment && char === "<") angle += 1;
    else if (!quoted && !comment && char === ">" && angle) angle -= 1;

    if (!quoted && !comment && !literal && char !== "(" && char !== ")" && char !== " " && char !== "\t") afterAt = char === "@";

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
 * Quoted strings and domain literals pass through verbatim, so `"a(b)"@x`, `"a  b"@x`, and
 * `a@[x(y)]` keep their text. Each run of comments and whitespace becomes `separator`: a space in
 * display names, nothing in an addr-spec, where CFWS around `@` and `.` carries no meaning.
 */
function stripComments(value: string, separator = " "): CommentedText {
  let text = "";
  let comment: string | undefined;
  let commentText = "";
  let depth = 0;
  let quoted = false;
  let literal = false;
  // Only CFWS has followed an `@` so far, so a `[` here opens a domain literal.
  let afterAt = false;
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

    if (escaped !== undefined && (quoted || literal || depth > 0)) index += 1;

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
    } else if (literal) {
      text += escaped ?? char;

      if (char === "]") literal = false;
    } else if (char === "(") {
      depth = 1;
      commentText = "";
    } else if (/\s/.test(char)) {
      pendingSpace = true;
    } else {
      append(char);

      if (char === "\"") quoted = true;
      else if (char === "[" && afterAt) literal = true;

      afterAt = char === "@";
    }
  }

  return { text, comment };
}

/** Unquote each quoted-string word of a display-name phrase on its own: `"John" "Doe"` is `John Doe`. */
function unquotePhrase(phrase: string): string {
  let result = "";
  let quoted = false;

  for (let index = 0; index < phrase.length; index += 1) {
    const char = phrase[index]!;

    if (char === "\\" && quoted) {
      result += phrase[index + 1] ?? "";
      index += 1;
    } else if (char === "\"") {
      quoted = !quoted;
    } else {
      result += char;
    }
  }

  return result.trim();
}

/** Drop an obsolete source route (`@a.example,@b.example:user@x`, RFC 5322 4.4) from an addr-spec. */
function withoutRoute(address: string): string {
  if (!address.startsWith("@")) return address;

  // Route domains may be literals such as `@[IPv6:2001:db8::1]`, whose colons are data.
  let literal = false;

  for (let index = 1; index < address.length; index += 1) {
    const char = address[index];

    if (literal) {
      if (char === "\\") index += 1;
      else if (char === "]") literal = false;
    } else if (char === "[") literal = true;
    else if (char === ":") return address.slice(index + 1);
    // A route is domains only, so a quote before its colon means there is no route.
    else if (char === "\"") return address;
  }

  return address;
}

/** Parse `"Ada, L." <ada@example.com>, bob@example.com` into addresses. */
export function parseAddressList(value: string | undefined): InboundAddress[] {
  if (!value) return [];

  const addresses: InboundAddress[] = [];

  for (const entry of splitAddressList(value)) {
    const angle = angleAddress(entry);

    if (angle) {
      const address = withoutRoute(stripComments(angle.address, "").text).replace(/^mailto:/i, "");
      const name = decodeEncodedWords(unquotePhrase(stripComments(entry.slice(0, angle.start)).text));

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

  // Every part counts against the budget, named or not, so unnamed parts cannot keep the scan going.
  for (const part of takeParts(binaryString(toBytes(body)), boundary, MAX_PARTS)) {
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
