"use client";

import { Area } from "./area";
import { AreaChart } from "./area-chart";
import type { AreaVariant } from "./chart-context";
import type { BloomInput } from "./dither-paint";
import type { DitherColor } from "./palette";

export type SparklineProps = {
  /** Plain numeric series — the common sparkline case. */
  data: number[];
  color: DitherColor;
  variant?: AreaVariant;
  /** Controlled crosshair position (e.g. a committed point). */
  markerIndex?: number | null;
  /** Parent-driven hover (e.g. the whole card/row) — lifts the fill. */
  hovered?: boolean;
  /** Glow on the dither fill. */
  bloom?: BloomInput;
  /** Only bloom while hovered. */
  bloomOnHover?: boolean;
  /** Play the entrance sweep — off by default for a calm spark. */
  animate?: boolean;
  className?: string;
};

/**
 * Thin wrapper over {@link AreaChart} for the decorative-sparkline case: a
 * single `number[]` series, no axes/grid/tooltip, no scrub crosshair (unless a
 * `markerIndex` is supplied). Keeps the hover brightness lift.
 */
export function Sparkline({
  data,
  color,
  variant = "gradient",
  markerIndex = null,
  hovered = false,
  bloom = "off",
  bloomOnHover = false,
  animate = false,
  className,
}: SparklineProps) {
  // React Compiler memoizes these against `data` / `color`.
  const rows = data.map((v) => ({ v }));
  const config = { v: { color } };

  return (
    <AreaChart
      data={rows}
      config={config}
      interactive={false}
      animate={animate}
      markerIndex={markerIndex}
      hovered={hovered}
      bloom={bloom}
      bloomOnHover={bloomOnHover}
      margins={{ top: 0, right: 0, bottom: 0, left: 0 }}
      className={className}
    >
      <Area dataKey="v" variant={variant} />
    </AreaChart>
  );
}
