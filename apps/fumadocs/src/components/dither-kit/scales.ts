// Pure geometry helpers for the dither chart engine. Kept framework-free so the
// context (and, later, bar/line/pie/radar roots) can share the same math.

import { scaleBand, scaleLinear, scalePoint } from "d3-scale";
import { stack as d3Stack, stackOffsetExpand } from "d3-shape";

export type StackType = "default" | "stacked" | "percent";

type Row = Record<string, unknown>;

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/**
 * Per-series [y0, y1] bands for every row. For `default` every series sits on
 * the floor (y0 = 0); for `stacked`/`percent` they pile on top of each other
 * via d3's stack layout. The shape `bands[key][i] = [y0, y1]` is what both the
 * SVG area paths and the canvas overlay read from.
 */
export function computeBands(
  data: Row[],
  keys: string[],
  stackType: StackType,
): { bands: Record<string, [number, number][]>; max: number } {
  if (stackType === "default") {
    const bands: Record<string, [number, number][]> = {};
    let max = 0;
    for (const key of keys) {
      bands[key] = data.map((row) => {
        const v = num(row[key]);
        if (v > max) max = v;
        return [0, v];
      });
    }
    return { bands: bands, max: max || 1 };
  }

  const series = d3Stack<Row>()
    .keys(keys)
    .value((row, key) => num(row[key]))
    .offset(stackType === "percent" ? stackOffsetExpand : (undefined as never))(data);

  const bands: Record<string, [number, number][]> = {};
  let max = 0;
  series.forEach((layer) => {
    bands[layer.key] = layer.map((point) => {
      if (point[1] > max) max = point[1];
      return [point[0], point[1]];
    });
  });
  return { bands, max: max || 1 };
}

/** x positions for each row index, evenly spread across the plot width. */
export function buildXScale(length: number, plotWidth: number) {
  return scalePoint<number>()
    .domain(Array.from({ length }, (_, i) => i))
    .range([0, plotWidth]);
}

/** Banded x for bar categories — each index owns a slot of `bandwidth` width. */
export function buildBandScale(length: number, plotWidth: number) {
  return scaleBand<number>()
    .domain(Array.from({ length }, (_, i) => i))
    .range([0, plotWidth])
    .paddingInner(0.28)
    .paddingOuter(0.18);
}

/** Index of the category whose band a horizontal pixel offset falls in. */
export function indexAtBand(px: number, length: number, plotWidth: number) {
  if (length <= 0 || plotWidth <= 0) return 0;
  const t = Math.max(0, Math.min(0.999, px / plotWidth));
  return Math.min(length - 1, Math.floor(t * length));
}

/** value → vertical pixel, with the floor at the bottom of the plot. */
export function buildYScale(max: number, plotHeight: number) {
  return scaleLinear().domain([0, max]).nice().range([plotHeight, 0]);
}

/** Index of the row nearest a horizontal pixel offset within the plot. */
export function nearestIndex(px: number, length: number, plotWidth: number) {
  if (length <= 1 || plotWidth <= 0) return 0;
  const t = Math.max(0, Math.min(1, px / plotWidth));
  return Math.round(t * (length - 1));
}
