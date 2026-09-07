// Real glyph advance widths from the TrueType fonts the OG image renders with.
//
// The sponsor row has to know how wide a label will be before resvg draws it.
// A per-character estimate cannot do that: Liberation Sans Bold puts "W" at
// 12.27px and "i" at 3.61px for the same 13px size, so an average either
// overflows the canvas on wide names or wastes space on narrow ones. Reading
// the font's own hmtx table gives the exact width the renderer will use.
import { readFileSync } from "node:fs";

type FontMetrics = {
  /** Width of the text at the given font size, in px. */
  measure: (text: string, fontSize: number) => number;
};

function readTables(view: DataView, bytes: Uint8Array): Record<string, number> {
  const tableCount = view.getUint16(4);
  const tables: Record<string, number> = {};
  for (let index = 0; index < tableCount; index++) {
    const record = 12 + index * 16;
    const tag = String.fromCharCode(
      bytes[record]!,
      bytes[record + 1]!,
      bytes[record + 2]!,
      bytes[record + 3]!,
    );
    tables[tag] = view.getUint32(record + 8);
  }
  return tables;
}

/** Offset of the Unicode "cmap" subtable, which must be format 4. */
function findUnicodeCmap(view: DataView, cmap: number): number {
  const subtableCount = view.getUint16(cmap + 2);
  let best = 0;
  for (let index = 0; index < subtableCount; index++) {
    const record = cmap + 4 + index * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    const isUnicode = platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));
    if (isUnicode) best = cmap + view.getUint32(record + 4);
  }
  if (!best) throw new Error("font has no Unicode cmap subtable");
  const format = view.getUint16(best);
  if (format !== 4) throw new Error(`unsupported cmap format ${format}`);
  return best;
}

export function loadFontMetrics(fontPath: string): FontMetrics {
  const bytes = readFileSync(fontPath);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = readTables(view, bytes);
  const head = tables.head;
  const hhea = tables.hhea;
  const hmtx = tables.hmtx;
  const cmap = tables.cmap;
  if (!head || !hhea || !hmtx || !cmap) throw new Error(`font is missing tables: ${fontPath}`);

  const unitsPerEm = view.getUint16(head + 18);
  const hMetricCount = view.getUint16(hhea + 34);
  const subtable = findUnicodeCmap(view, cmap);

  const segmentCount = view.getUint16(subtable + 6) / 2;
  const endCodes = subtable + 14;
  const startCodes = endCodes + segmentCount * 2 + 2;
  const deltas = startCodes + segmentCount * 2;
  const rangeOffsets = deltas + segmentCount * 2;

  function glyphId(codePoint: number): number {
    for (let index = 0; index < segmentCount; index++) {
      if (view.getUint16(endCodes + index * 2) < codePoint) continue;
      const start = view.getUint16(startCodes + index * 2);
      if (start > codePoint) return 0;
      const delta = view.getInt16(deltas + index * 2);
      const rangeOffset = view.getUint16(rangeOffsets + index * 2);
      if (rangeOffset === 0) return (codePoint + delta) & 0xffff;
      const glyph = view.getUint16(
        rangeOffsets + index * 2 + rangeOffset + (codePoint - start) * 2,
      );
      return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
    }
    return 0;
  }

  const advances = new Map<number, number>();
  function advance(codePoint: number): number {
    const cached = advances.get(codePoint);
    if (cached !== undefined) return cached;
    // Glyphs past the last hMetric all reuse that metric's advance.
    const metric = Math.min(glyphId(codePoint), hMetricCount - 1);
    const width = view.getUint16(hmtx! + metric * 4) / unitsPerEm;
    advances.set(codePoint, width);
    return width;
  }

  return {
    measure(text, fontSize) {
      let total = 0;
      for (const character of text) total += advance(character.codePointAt(0)!);
      return total * fontSize;
    },
  };
}
