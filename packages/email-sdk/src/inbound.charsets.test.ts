import { afterEach, describe, expect, test } from "bun:test";
import { decodeCharset, decodeEncodedWords, decodeSingleByte } from "./inbound/mime.js";
import { charsetLabels, singleByteUpperHalves } from "./inbound/single-byte-charsets.js";

const allBytes = Uint8Array.from({ length: 256 }, (_, index) => index);

/** The runtime's decoding of every byte, or `undefined` when its `TextDecoder` lacks the label. */
function runtimeDecode(label: string): string | undefined {
  try {
    return new TextDecoder(label).decode(allBytes);
  } catch {
    return undefined;
  }
}

describe("single-byte charset tables", () => {
  const labels = [...singleByteUpperHalves.keys()].flatMap(name => [name, ...(charsetLabels.get(name)?.split(" ") ?? [])].map(label => [name, label] as const));

  for (const [name, label] of labels) {
    const expected = runtimeDecode(label);

    // A runtime without the encoding, such as Bun 1.3, has nothing to compare against.
    test.skipIf(expected === undefined)(`${name} via ${label} matches the runtime TextDecoder`, () => {
      expect(decodeSingleByte(allBytes, name)).toBe(expected);
    });
  }

  test("every table maps all 128 upper-half bytes", () => {
    for (const [name, half] of singleByteUpperHalves) expect([name, half.length]).toEqual([name, 128]);
  });

  test("an encoding without a table has no fallback", () => {
    expect(decodeSingleByte(allBytes, "shift_jis")).toBeUndefined();
  });
});

describe("single-byte fallback when TextDecoder lacks the encoding", () => {
  const RuntimeTextDecoder = globalThis.TextDecoder;

  afterEach(() => {
    globalThis.TextDecoder = RuntimeTextDecoder;
  });

  /** Replace `TextDecoder` with one that rejects every label except UTF-8, like a minimal runtime. */
  function utf8OnlyTextDecoder(): void {
    globalThis.TextDecoder = class extends RuntimeTextDecoder {
      constructor(label?: string, options?: TextDecoderOptions) {
        if (label !== undefined && label !== "utf-8") throw new RangeError(`Unsupported encoding label "${label}"`);

        super(label, options);
      }
    };
  }

  test("bodies and encoded words decode from the built-in tables", () => {
    utf8OnlyTextDecoder();

    expect(() => new TextDecoder("iso-8859-15")).toThrow();
    expect(decodeEncodedWords("=?ISO-8859-1?Q?=E9?= =?ISO-8859-15?Q?=A4?=")).toBe("é€");
    expect(decodeEncodedWords("=?koi8-r?B?8NLJ18XU?=")).toBe("Привет");
    expect(decodeCharset(Uint8Array.of(0xcf, 0xf0, 0xe8, 0xe2, 0xe5, 0xf2), "cp1251")).toBe("Привет");
    expect(decodeCharset(Uint8Array.of(0x50, 0xf8, 0xed, 0x6c, 0x69, 0xb9), "latin2")).toBe("Příliš");
    expect(decodeCharset(Uint8Array.of(0x80, 0x81), "windows-1252")).toBe("€\u0081");
  });

  test("a byte the encoding leaves unmapped becomes U+FFFD", () => {
    utf8OnlyTextDecoder();

    expect(decodeCharset(Uint8Array.of(0x41, 0xa5), "iso-8859-3")).toBe("A�");
  });

  test("an unknown label still falls back to UTF-8, then Latin-1", () => {
    utf8OnlyTextDecoder();

    expect(decodeCharset(Uint8Array.of(0xc3, 0xa9), "x-unknown")).toBe("é");
    expect(decodeCharset(Uint8Array.of(0xe9), "x-unknown")).toBe("é");
  });
});
