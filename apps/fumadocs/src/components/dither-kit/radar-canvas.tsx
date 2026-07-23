"use client";

import { useEffect, useRef } from "react";
import {
  BAYER,
  backingSize,
  bloomLayerStyle,
  easeInOutCubic,
  OFF_TIER,
  prefersReducedMotion,
} from "./dither-paint";
import { rgb } from "./palette";
import { distToPolygonEdge, pointInPolygon, polarX, polarY } from "./polar";
import { usePolarChart } from "./polar-context";

/**
 * Dither canvas for radar charts. Each series is a closed polygon over the
 * spokes (value → radius per axis). Backing pixels inside a polygon are filled
 * with the ordered-dither scatter — dense near the polygon edge, thinning toward
 * the centre — and each vertex is marked with a bright dot (larger on the hovered
 * axis). The polygons scale in from the centre on mount.
 */
export function RadarCanvas() {
  const ctx = usePolarChart();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const bloomRef = useRef<HTMLCanvasElement>(null);

  const { width, height } = ctx.plot;
  const { cols, rows } = backingSize(width, height);

  // The RAF loop reads the latest ctx through a ref; written in an effect
  // (never during render) for the compiler.
  const state = useRef(ctx);
  useEffect(() => {
    state.current = ctx;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const c = canvas?.getContext("2d");
    if (!(canvas && c) || cols <= 0 || rows <= 0) return;
    canvas.width = cols;
    canvas.height = rows;

    const bloomCanvas = bloomRef.current;
    const bloomCtx = bloomCanvas?.getContext("2d") ?? null;
    if (bloomCanvas) {
      bloomCanvas.width = cols;
      bloomCanvas.height = rows;
    }

    const reduce = prefersReducedMotion();
    const animate = state.current.animate && !reduce;
    const duration = state.current.animationDuration;
    let raf = 0;
    let animStart = 0;
    let lastProg = -1;
    let lastRevision = state.current.revision;
    let intensity = 0;
    let needsFill = true;
    let lastSelected: string | null | undefined = Symbol() as never;
    let lastHover: number | null | undefined = Symbol() as never;

    const fx = cols / Math.max(width, 1);
    const fy = rows / Math.max(height, 1);

    // Build each series polygon in plot coords, scaled by `prog`.
    const buildPolys = (prog: number) => {
      const s = state.current;
      const radar = s.radar;
      if (!radar) return [];
      return s.configKeys.map((key) => {
        const poly: number[] = [];
        const pts: { x: number; y: number }[] = [];
        radar.axes.forEach((ax, i) => {
          const v = Number(s.data[i]?.[key]) || 0;
          const r = (v / radar.max) * s.outerRadius * prog;
          const x = polarX(s.center.x, r, ax.angle);
          const y = polarY(s.center.y, r, ax.angle);
          poly.push(x, y);
          pts.push({ x, y });
        });
        return { key, poly, pts };
      });
    };

    const paint = (prog: number) => {
      const s = state.current;
      if (!s.radar) return;
      c.clearRect(0, 0, cols, rows);
      const polys = buildPolys(easeInOutCubic(prog));
      const band = Math.max(s.outerRadius * 0.45, 1);

      for (let y = 0; y < rows; y++) {
        const py = ((y + 0.5) * height) / rows;
        for (let x = 0; x < cols; x++) {
          const px = ((x + 0.5) * width) / cols;
          // Whether a layer behind already coloured this pixel — front layers
          // then keep true gaps in their dither so the back layer shows
          // through, instead of tinting the overlap into a muddy blend.
          let covered = false;
          for (let pi = 0; pi < polys.length; pi++) {
            const { key, poly } = polys[pi];
            if (!pointInPolygon(px, py, poly)) continue;
            const seed = s.seedOf(key);
            const variant = s.variantOf(key);
            const emphasis = s.selectedDataKey ?? s.focusDataKey;
            const selDim = emphasis !== null && emphasis !== key ? 0.3 : 1;
            const dist = distToPolygonEdge(px, py, poly);
            if (dist < 1.4) {
              c.fillStyle = rgb(seed.fill, 1, selDim);
              c.fillRect(x, y, 1, 1);
              covered = true;
              continue;
            }
            const density = 1 - Math.min(1, dist / band);
            const bias = variant === "dotted" ? 0.12 : 0;
            // Thin each successive (front) layer so overlapping polygons
            // read as distinct layers, not a muddy blend.
            const sparse = pi * 0.2;
            if (variant === "hatched" && ((x + y) & 3) >= 2) continue;
            const lit =
              variant === "solid" ||
              density > BAYER[y & 3][x & 3] - 0.1 * intensity - bias + sparse;
            // Unlit cells: over another layer, stay a real gap (back layer
            // shows through); over bare background, paint the faint tier so
            // the page never bleeds in.
            if (!lit && (variant === "dotted" || covered)) continue;
            const k = (0.32 + density * 0.68) * (1 + 0.22 * intensity);
            const alpha = Math.min(1, (lit ? k : k * OFF_TIER) * selDim);
            c.fillStyle = rgb(seed.fill, 1, alpha);
            c.fillRect(x, y, 1, 1);
            covered = true;
          }
        }
      }

      // Vertex markers — larger on the hovered axis.
      for (const { key, pts } of polys) {
        const seed = s.seedOf(key);
        const emphasis = s.selectedDataKey ?? s.focusDataKey;
        const selDim = emphasis !== null && emphasis !== key ? 0.3 : 1;
        pts.forEach((p, i) => {
          const bx = Math.round(p.x * fx);
          const by = Math.round(p.y * fy);
          const big = s.hoverIndex === i;
          c.fillStyle = rgb(seed.fill, 1, selDim);
          const sz = big ? 2 : 1;
          c.fillRect(bx - (sz - 1), by - (sz - 1), sz * 2 - 1, sz * 2 - 1);
        });
      }
    };

    const draw = (now: number) => {
      raf = requestAnimationFrame(draw);
      const s = state.current;
      if (!s.ready || !s.radar) return;
      if (bloomCtx) {
        const on = s.bloom !== "off" && (!s.bloomOnHover || s.isMouseInChart);
        if (on) {
          bloomCtx.clearRect(0, 0, cols, rows);
          bloomCtx.drawImage(canvas, 0, 0);
        }
      }
      if (s.revision !== lastRevision) {
        lastRevision = s.revision;
        animStart = 0;
        lastProg = -1;
      }
      if (!animStart) animStart = now;
      const prog = animate ? Math.min(1, (now - animStart) / duration) : 1;

      const emphasisNow = s.selectedDataKey ?? s.focusDataKey;
      if (emphasisNow !== lastSelected) {
        lastSelected = emphasisNow;
        needsFill = true;
      }
      if (s.hoverIndex !== lastHover) {
        lastHover = s.hoverIndex;
        needsFill = true;
      }
      const itTarget = s.isMouseInChart ? 1 : 0;
      if (Math.abs(intensity - itTarget) > 0.001) {
        intensity += (itTarget - intensity) * (reduce ? 1 : 0.16);
        needsFill = true;
      } else intensity = itTarget;
      if (prog !== lastProg) {
        lastProg = prog;
        needsFill = true;
      }

      if (!needsFill) return;
      paint(prog);
      needsFill = false;
    };

    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [cols, rows, width, height]);

  const bloom = bloomLayerStyle(ctx.bloom, ctx.bloomOnHover ? ctx.isMouseInChart : true);
  const pos = {
    left: ctx.margins.left,
    top: ctx.margins.top,
    width,
    height,
  } as const;

  return (
    <>
      <canvas
        ref={canvasRef}
        className="pointer-events-none absolute"
        style={{ ...pos, imageRendering: "pixelated" }}
      />
      <canvas
        ref={bloomRef}
        className="pointer-events-none absolute"
        style={{
          ...pos,
          transition: "opacity 220ms ease",
          ...(bloom ?? { opacity: 0 }),
        }}
      />
    </>
  );
}
