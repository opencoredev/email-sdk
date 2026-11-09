/**
 * Writes packages/email-sdk/src/inbound/single-byte-charsets.ts: the upper half (bytes 0x80-0xFF)
 * of each WHATWG single-byte encoding, plus the WHATWG labels that name it. Some runtimes, such as
 * Bun 1.3, ship a `TextDecoder` without most of these encodings; the inbound parser falls back to
 * the tables when `TextDecoder` rejects a label.
 *
 * Run it with a `TextDecoder` that supports every encoding (Bun 1.4+, or Node with full ICU):
 *
 *   bun scripts/generate-single-byte-charsets.ts
 *
 * Labels come from the WHATWG Encoding Standard (https://encoding.spec.whatwg.org/#names-and-labels).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const output = fileURLToPath(new URL("../packages/email-sdk/src/inbound/single-byte-charsets.ts", import.meta.url));

/** Each single-byte encoding's name, then its other WHATWG labels. */
const singleByte: [name: string, labels: string[]][] = [
  ["ibm866", ["866", "cp866", "csibm866"]],
  ["iso-8859-2", ["csisolatin2", "iso-ir-101", "iso8859-2", "iso88592", "iso_8859-2", "iso_8859-2:1987", "l2", "latin2"]],
  ["iso-8859-3", ["csisolatin3", "iso-ir-109", "iso8859-3", "iso88593", "iso_8859-3", "iso_8859-3:1988", "l3", "latin3"]],
  ["iso-8859-4", ["csisolatin4", "iso-ir-110", "iso8859-4", "iso88594", "iso_8859-4", "iso_8859-4:1988", "l4", "latin4"]],
  ["iso-8859-5", ["csisolatincyrillic", "cyrillic", "iso-ir-144", "iso8859-5", "iso88595", "iso_8859-5", "iso_8859-5:1988"]],
  [
    "iso-8859-6",
    ["arabic", "asmo-708", "csiso88596e", "csiso88596i", "csisolatinarabic", "ecma-114", "iso-8859-6-e", "iso-8859-6-i", "iso-ir-127", "iso8859-6", "iso88596", "iso_8859-6", "iso_8859-6:1987"],
  ],
  ["iso-8859-7", ["csisolatingreek", "ecma-118", "elot_928", "greek", "greek8", "iso-ir-126", "iso8859-7", "iso88597", "iso_8859-7", "iso_8859-7:1987", "sun_eu_greek"]],
  // ISO-8859-8-I decodes exactly like ISO-8859-8, so its labels share the table.
  [
    "iso-8859-8",
    ["csiso88598e", "csisolatinhebrew", "hebrew", "iso-8859-8-e", "iso-ir-138", "iso8859-8", "iso88598", "iso_8859-8", "iso_8859-8:1988", "visual", "csiso88598i", "iso-8859-8-i", "logical"],
  ],
  ["iso-8859-10", ["csisolatin6", "iso-ir-157", "iso8859-10", "iso885910", "l6", "latin6"]],
  ["iso-8859-13", ["iso8859-13", "iso885913"]],
  ["iso-8859-14", ["iso8859-14", "iso885914"]],
  ["iso-8859-15", ["csisolatin9", "iso8859-15", "iso885915", "iso_8859-15", "l9"]],
  ["iso-8859-16", []],
  ["koi8-r", ["cskoi8r", "koi", "koi8", "koi8_r"]],
  ["koi8-u", ["koi8-ru"]],
  ["macintosh", ["csmacintosh", "mac", "x-mac-roman"]],
  ["windows-874", ["dos-874", "iso-8859-11", "iso8859-11", "iso885911", "tis-620"]],
  ["windows-1250", ["cp1250", "x-cp1250"]],
  ["windows-1251", ["cp1251", "x-cp1251"]],
  // `ascii` and `us-ascii` are also WHATWG labels for windows-1252, but the parser reads them as UTF-8.
  [
    "windows-1252",
    ["ansi_x3.4-1968", "cp1252", "cp819", "csisolatin1", "ibm819", "iso-8859-1", "iso-ir-100", "iso8859-1", "iso88591", "iso_8859-1", "iso_8859-1:1987", "l1", "latin1", "x-cp1252"],
  ],
  ["windows-1253", ["cp1253", "x-cp1253"]],
  ["windows-1254", ["cp1254", "csisolatin5", "iso-8859-9", "iso-ir-148", "iso8859-9", "iso88599", "iso_8859-9", "iso_8859-9:1989", "l5", "latin5", "x-cp1254"]],
  ["windows-1255", ["cp1255", "x-cp1255"]],
  ["windows-1256", ["cp1256", "x-cp1256"]],
  ["windows-1257", ["cp1257", "x-cp1257"]],
  ["windows-1258", ["cp1258", "x-cp1258"]],
  ["x-mac-cyrillic", ["x-mac-ukrainian"]],
];

/**
 * UTF labels, so byte order mark removal sees the canonical name. `utf-16` is left out on purpose:
 * WHATWG reads it as UTF-16LE, but the parser lets an unmarked `utf-16` take its order from the mark.
 */
const unicode: [name: string, labels: string[]][] = [
  ["utf-8", ["unicode-1-1-utf-8", "unicode11utf8", "unicode20utf8", "utf8", "x-unicode20utf8"]],
  ["utf-16be", ["unicodefffe"]],
  ["utf-16le", ["csunicode", "iso-10646-ucs-2", "ucs-2", "unicode", "unicodefeff"]],
];

const allBytes = Uint8Array.from({ length: 256 }, (_, index) => index);

function decodeAll(label: string): string {
  try {
    return new TextDecoder(label).decode(allBytes);
  } catch {
    throw new Error(`This runtime's TextDecoder does not support "${label}". Run the generator with Bun 1.4+ or Node with full ICU.`);
  }
}

const ascii = String.fromCharCode(...allBytes.subarray(0, 0x80));

/** Escape invisible, control, and private-use characters so the generated source stays readable. */
function literal(text: string): string {
  return `"${text.replace(/[\p{C}\p{Z}"\\]/gu, char => `\\u${char.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`)}"`;
}

const tables = singleByte.map(([name, labels]) => {
  const decoded = decodeAll(name);

  if (decoded.length !== 256 || !decoded.startsWith(ascii)) throw new Error(`${name} does not map bytes 0x00-0x7F to ASCII one to one.`);

  for (const label of labels) {
    if (decodeAll(label) !== decoded) throw new Error(`The label "${label}" does not decode like ${name}.`);

    if (!new TextDecoder(label).encoding.startsWith(name)) throw new Error(`The label "${label}" is not a WHATWG label for ${name}.`);
  }

  return `  ["${name}", ${literal(decoded.slice(0x80))}],`;
});

for (const [name, labels] of unicode) {
  const sample = new TextEncoder().encode("A\u00e9\u{1f600}");
  const expected = new TextDecoder(name).decode(name === "utf-8" ? sample : allBytes);

  for (const label of labels) {
    const decoder = new TextDecoder(label);

    if (decoder.encoding !== name || decoder.decode(name === "utf-8" ? sample : allBytes) !== expected) throw new Error(`The label "${label}" does not decode like ${name}.`);
  }
}

const aliases = [...singleByte, ...unicode].flatMap(([name, labels]) => (labels.length ? [`  ["${name}", "${labels.join(" ")}"],`] : []));

writeFileSync(
  output,
  `// Generated by scripts/generate-single-byte-charsets.ts. Do not edit by hand.

/**
 * Bytes 0x80-0xFF of each WHATWG single-byte encoding, one character per byte; bytes 0x00-0x7F
 * are ASCII in all of them. U+FFFD marks a byte the encoding leaves unmapped.
 */
export const singleByteUpperHalves = new Map<string, string>([
${tables.join("\n")}
]);

/** WHATWG labels, space separated, for each encoding besides its own name. */
export const charsetLabels = new Map<string, string>([
${aliases.join("\n")}
]);
`,
);

console.log(`Wrote ${tables.length} single-byte tables to ${output}`);
