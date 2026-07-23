"use client";

import { polarX, polarY } from "./polar";
import { usePolarChart } from "./polar-context";

const LEVELS = 4;

/** Built-in radar chrome: concentric polygon rings, spokes, and axis labels.
 * Rendered behind the dither canvas by the radar root. */
export function RadarFrame() {
  const ctx = usePolarChart();
  if (!ctx.ready || !ctx.radar) return null;
  const { axes } = ctx.radar;
  const { x: cx, y: cy } = ctx.center;
  const R = ctx.outerRadius;

  const ring = (radius: number) =>
    `${axes
      .map(
        (ax, i) =>
          `${i === 0 ? "M" : "L"}${polarX(cx, radius, ax.angle).toFixed(1)},${polarY(cy, radius, ax.angle).toFixed(1)}`,
      )
      .join(" ")} Z`;

  return (
    <g>
      <g className="stroke-border" fill="none">
        {Array.from({ length: LEVELS }, (_, l) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed ring levels
          <path key={l} d={ring((R * (l + 1)) / LEVELS)} />
        ))}
        {axes.map((ax, i) => (
          <line
            key={ax.label}
            x1={cx}
            y1={cy}
            x2={polarX(cx, R, ax.angle)}
            y2={polarY(cy, R, ax.angle)}
            className={ctx.hoverIndex === i ? "stroke-foreground" : undefined}
          />
        ))}
      </g>
      <g className="font-mono text-[10px]">
        {axes.map((ax, i) => {
          const lx = polarX(cx, R + 10, ax.angle);
          const ly = polarY(cy, R + 10, ax.angle);
          const anchor =
            Math.abs(Math.cos(ax.angle)) < 0.3
              ? "middle"
              : Math.cos(ax.angle) > 0
                ? "start"
                : "end";
          const hot = ctx.hoverIndex === i;
          return (
            <text
              key={ax.label}
              x={lx}
              y={ly}
              textAnchor={anchor}
              dominantBaseline="central"
              className={hot ? "fill-foreground" : "fill-muted-foreground"}
            >
              {ax.label}
            </text>
          );
        })}
      </g>
    </g>
  );
}

RadarFrame.chartLayer = "back" as const;
