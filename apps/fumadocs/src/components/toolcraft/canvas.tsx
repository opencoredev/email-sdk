/**
 * Adapted from Toolcraft (https://toolcraft.sh, MIT): runtime/react/canvas/canvas-shell.tsx and
 * use-canvas-viewport-interactions.ts. The media layer, upload routing, and store-backed zoom are
 * removed; the viewport keeps drag-to-pan, Ctrl/⌘ + wheel or pinch to zoom, keyboard zoom, and
 * fit to view. Plain wheel scrolling is left to the page. See NOTICE.md.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent, ReactNode } from "react";
import { Maximize, ZoomIn, ZoomOut } from "lucide-react";

import { cn } from "@/lib/cn";

import { IconButton } from "./button";

export type CanvasRect = { x: number; y: number; width: number; height: number };

export type CanvasProps = {
  label: string;
  /** Size of the world content in world pixels. */
  width: number;
  height: number;
  children: ReactNode;
  /** A world rect to keep in view, such as the selected node. Pans only when it is off screen. */
  revealRect?: CanvasRect;
  /** Overlays pinned to the viewport corners. */
  overlay?: ReactNode;
  className?: string;
};

type Viewport = { x: number; y: number; zoom: number };

const minZoom = 0.25;

const maxZoom = 2;

const fitPadding = 32;

const panKeys = new Map<string, readonly [number, number]>([
  ["ArrowLeft", [40, 0]],
  ["ArrowRight", [-40, 0]],
  ["ArrowUp", [0, 40]],
  ["ArrowDown", [0, -40]],
]);

function clampZoom(zoom: number) {
  return Math.min(maxZoom, Math.max(minZoom, zoom));
}

export function Canvas({ label, width, height, children, revealRect, overlay, className }: CanvasProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ pointerId: number; startX: number; startY: number; origin: Viewport } | null>(null);
  const [view, setView] = useState<Viewport>({ x: 0, y: 0, zoom: 1 });
  const [panning, setPanning] = useState(false);

  /** `whole` fits the full world; `width` fits its width at no more than 100% and aligns the top. */
  const fit = useCallback(
    (mode: "whole" | "width" = "whole") => {
      const element = viewportRef.current;

      if (!element) return;

      const { clientWidth, clientHeight } = element;
      const widthZoom = (clientWidth - fitPadding * 2) / width;
      const zoom = clampZoom(mode === "width" ? Math.min(widthZoom, 1) : Math.min(widthZoom, (clientHeight - fitPadding * 2) / height, 1));
      const centeredY = (clientHeight - height * zoom) / 2;

      setView({ zoom, x: (clientWidth - width * zoom) / 2, y: mode === "width" ? Math.max(fitPadding / 2, centeredY) : Math.max(fitPadding, centeredY) });
    },
    [width, height],
  );

  useLayoutEffect(() => {
    fit("width");

    const element = viewportRef.current;

    if (!element) return;

    let lastWidth = element.clientWidth;

    const observer = new ResizeObserver(() => {
      if (element.clientWidth === lastWidth) return;

      lastWidth = element.clientWidth;
      fit("width");
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [fit]);

  const zoomAt = useCallback((factor: number, clientX?: number, clientY?: number) => {
    const element = viewportRef.current;

    if (!element) return;

    const rect = element.getBoundingClientRect();
    const px = clientX === undefined ? rect.width / 2 : clientX - rect.left;
    const py = clientY === undefined ? rect.height / 2 : clientY - rect.top;

    setView((current) => {
      const zoom = clampZoom(current.zoom * factor);
      const scale = zoom / current.zoom;

      return { zoom, x: px - (px - current.x) * scale, y: py - (py - current.y) * scale };
    });
  }, []);

  // React's onWheel is passive, so preventDefault for Ctrl/⌘ + wheel needs a native listener.
  useEffect(() => {
    const element = viewportRef.current;

    if (!element) return;

    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return;

      event.preventDefault();
      zoomAt(Math.exp(-event.deltaY * 0.01), event.clientX, event.clientY);
    };

    element.addEventListener("wheel", onWheel, { passive: false });

    return () => element.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  useEffect(() => {
    const element = viewportRef.current;

    if (!element || !revealRect) return;

    setView((current) => {
      const margin = 24;
      const left = current.x + revealRect.x * current.zoom;
      const top = current.y + revealRect.y * current.zoom;
      const right = left + revealRect.width * current.zoom;
      const bottom = top + revealRect.height * current.zoom;
      let { x, y } = current;

      if (left < margin) x += margin - left;
      else if (right > element.clientWidth - margin) x -= right - (element.clientWidth - margin);

      if (top < margin) y += margin - top;
      else if (bottom > element.clientHeight - margin) y -= bottom - (element.clientHeight - margin);

      return x === current.x && y === current.y ? current : { ...current, x, y };
    });
  }, [revealRect?.x, revealRect?.y, revealRect?.width, revealRect?.height]);

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target instanceof Element && event.target.closest("button,a,[role=option]"))) return;

    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: view };
    setPanning(true);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current;

    if (!current || current.pointerId !== event.pointerId) return;

    setView({ ...current.origin, x: current.origin.x + event.clientX - current.startX, y: current.origin.y + event.clientY - current.startY });
  }

  function endPan(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;

    drag.current = null;
    setPanning(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.target !== event.currentTarget) return;

    if (event.key === "+" || event.key === "=") zoomAt(1.2);
    else if (event.key === "-") zoomAt(1 / 1.2);
    else if (event.key === "0") fit("whole");
    else {
      const delta = panKeys.get(event.key);

      if (!delta) return;

      setView((current) => ({ ...current, x: current.x + delta[0], y: current.y + delta[1] }));
    }

    event.preventDefault();
  }

  return (
    <div className={cn("relative min-h-0 min-w-0 overflow-hidden", className)} data-slot="canvas">
      <div
        aria-label={`${label}. Drag to pan, Ctrl or Command plus scroll to zoom. When focused: arrow keys pan, plus and minus zoom, 0 fits.`}
        aria-roledescription="canvas"
        className={cn(
          "absolute inset-0 touch-none outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--ring)]",
          panning ? "cursor-grabbing" : "cursor-grab",
        )}
        onKeyDown={onKeyDown}
        onPointerCancel={endPan}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPan}
        ref={viewportRef}
        role="region"
        style={{
          backgroundImage: "radial-gradient(circle, color-mix(in oklab, var(--foreground) 16%, transparent) 1px, transparent 1.2px)",
          backgroundPosition: `${view.x}px ${view.y}px`,
          backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`,
        }}
        tabIndex={0}
      >
        <div
          className="absolute top-0 left-0 origin-top-left"
          style={{ width, height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})` }}
        >
          {children}
        </div>
      </div>
      {overlay}
      <div className="absolute right-2 bottom-2 flex items-center gap-0.5 rounded-lg border border-[color:color-mix(in_oklab,var(--border)_12%,transparent)] bg-[color:var(--panel)] p-0.5">
        <IconButton label="Zoom out" onClick={() => zoomAt(1 / 1.2)}>
          <ZoomOut />
        </IconButton>
        <span aria-live="polite" className="w-10 text-center font-mono text-[11px] tabular-nums text-[color:color-mix(in_oklab,var(--foreground)_64%,transparent)]">
          {Math.round(view.zoom * 100)}%
        </span>
        <IconButton label="Zoom in" onClick={() => zoomAt(1.2)}>
          <ZoomIn />
        </IconButton>
        <IconButton label="Fit to view" onClick={() => fit("whole")}>
          <Maximize />
        </IconButton>
      </div>
    </div>
  );
}
