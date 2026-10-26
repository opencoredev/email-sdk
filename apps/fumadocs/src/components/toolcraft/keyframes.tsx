/**
 * Adapted from Toolcraft (https://toolcraft.sh, MIT): runtime/react/timeline/timeline-keyframe-row.tsx
 * and timeline-icon-button.tsx. Keyframes are read-only stops on one track (no dragging or easing);
 * they form a radio group with arrow-key navigation, and the playhead follows the current one.
 * See NOTICE.md.
 */
import { useRef } from "react";
import type { KeyboardEvent } from "react";
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";

import { cn } from "@/lib/cn";

import { IconButton } from "./button";

export type Keyframe = { id: string; atMs: number; label: string };

export type KeyframesProps = {
  label: string;
  keyframes: readonly Keyframe[];
  durationMs: number;
  currentIndex: number;
  onCurrentIndexChange: (index: number) => void;
  playing: boolean;
  onPlayingChange: (playing: boolean) => void;
  /** Tick marks along the track, in ms. */
  ticks: readonly { atMs: number; label: string }[];
  formatTime: (ms: number) => string;
};

// The track starts a few pixels in so the first diamond isn't clipped, as in Toolcraft.
const trackInset = 10;

function position(atMs: number, durationMs: number) {
  const ratio = durationMs <= 0 ? 0 : Math.min(1, Math.max(0, atMs / durationMs));

  return `calc(${trackInset}px + (100% - ${trackInset * 2}px) * ${ratio})`;
}

export function Keyframes({ label, keyframes, durationMs, currentIndex, onCurrentIndexChange, playing, onPlayingChange, ticks, formatTime }: KeyframesProps) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const current = keyframes[currentIndex];
  const last = keyframes.length - 1;

  function select(index: number) {
    const next = Math.min(last, Math.max(0, index));

    onPlayingChange(false);
    onCurrentIndexChange(next);
    refs.current[next]?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const index = event.key === "ArrowRight" ? currentIndex + 1 : event.key === "ArrowLeft" ? currentIndex - 1 : event.key === "Home" ? 0 : event.key === "End" ? last : undefined;

    if (index === undefined) return;

    event.preventDefault();
    select(index);
  }

  return (
    <div className="flex flex-col gap-2 px-3 py-2" data-slot="keyframes">
      <div className="flex items-center gap-1">
        <IconButton disabled={currentIndex === 0} label="Previous keyframe" onClick={() => select(currentIndex - 1)} size="icon-sm">
          <SkipBack />
        </IconButton>
        <IconButton
          aria-pressed={playing}
          label={playing ? "Pause playback" : "Play from the start"}
          onClick={() => {
            if (!playing && currentIndex === last) onCurrentIndexChange(0);

            onPlayingChange(!playing);
          }}
          size="icon-sm"
        >
          {playing ? <Pause /> : <Play />}
        </IconButton>
        <IconButton disabled={currentIndex === last} label="Next keyframe" onClick={() => select(currentIndex + 1)} size="icon-sm">
          <SkipForward />
        </IconButton>
        <p aria-live="polite" className="m-0 ml-2 min-w-0 text-xs text-[color:var(--foreground)] sm:truncate">
          <span className="mr-2 font-mono tabular-nums text-[color:color-mix(in_oklab,var(--foreground)_56%,transparent)]">{current ? formatTime(current.atMs) : ""}</span>
          {current?.label}
        </p>
      </div>
      <div className="relative h-9" data-slot="timeline-keyframe-track">
        <span aria-hidden="true" className="absolute top-3 right-[10px] left-[10px] h-px bg-[color:color-mix(in_oklab,var(--accent)_40%,transparent)]" />
        {ticks.map((tick) => (
          <span
            aria-hidden="true"
            className="absolute top-6 -translate-x-1/2 font-mono text-[10px] tabular-nums text-[color:color-mix(in_oklab,var(--foreground)_48%,transparent)]"
            key={tick.atMs}
            style={{ left: position(tick.atMs, durationMs) }}
          >
            {tick.label}
          </span>
        ))}
        {current ? (
          <span
            aria-hidden="true"
            className="absolute top-0 h-6 w-px bg-[color:var(--foreground)] motion-safe:transition-[left] motion-safe:duration-300 motion-safe:ease-out"
            style={{ left: position(current.atMs, durationMs) }}
          />
        ) : null}
        <div aria-label={label} className="absolute inset-x-0 top-0 h-6" role="radiogroup">
          {keyframes.map((keyframe, index) => {
            const checked = index === currentIndex;

            return (
              <button
                aria-checked={checked}
                aria-label={`${formatTime(keyframe.atMs)}: ${keyframe.label}`}
                className="absolute top-3 z-10 flex size-6 -translate-x-1/2 -translate-y-1/2 cursor-pointer items-center justify-center rounded-md text-[color:var(--accent)] outline-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[color:var(--ring)]"
                key={keyframe.id}
                onClick={() => select(index)}
                onKeyDown={onKeyDown}
                ref={(element) => {
                  refs.current[index] = element;
                }}
                role="radio"
                style={{ left: position(keyframe.atMs, durationMs) }}
                tabIndex={checked ? 0 : -1}
                title={keyframe.label}
                type="button"
              >
                <span aria-hidden="true" className={cn("block size-[9px] rotate-45 rounded-[1px]", checked ? "bg-[color:var(--foreground)]" : "bg-current")} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
