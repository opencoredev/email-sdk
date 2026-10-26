/**
 * Adapted from Toolcraft (https://toolcraft.sh, MIT): runtime/react/layers/layers-panel-row.tsx.
 * Drag reordering, renaming, and visibility toggles are removed; rows are a single-select listbox
 * with roving focus where selection follows focus. See NOTICE.md.
 */
import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/cn";

export type LayerItem = {
  id: string;
  name: string;
  icon: ReactNode;
  /** Right-aligned detail, such as a time offset. */
  meta?: string;
  depth: number;
  /** Dims the row, as Toolcraft does for hidden layers. */
  muted?: boolean;
  /** A small status mark before the meta text. */
  status?: ReactNode;
};

export type LayerGroup = { id: string; label: string; depth: number; items: LayerItem[] };

export type LayersPanelProps = {
  label: string;
  groups: readonly LayerGroup[];
  selectedId: string;
  onSelect: (id: string) => void;
};

const indentPx = 14;

export function LayersPanel({ label, groups, selectedId, onSelect }: LayersPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const order = groups.flatMap((group) => group.items.map((item) => item.id));

  function focusRow(id: string) {
    onSelect(id);
    listRef.current?.querySelector<HTMLElement>(`[data-layer-id="${CSS.escape(id)}"]`)?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>, id: string) {
    const index = order.indexOf(id);

    const next =
      event.key === "ArrowDown"
        ? order[Math.min(order.length - 1, index + 1)]
        : event.key === "ArrowUp"
          ? order[Math.max(0, index - 1)]
          : event.key === "Home"
            ? order[0]
            : event.key === "End"
              ? order.at(-1)
              : undefined;

    if (next === undefined) return;

    event.preventDefault();
    focusRow(next);
  }

  return (
    <div aria-label={label} className="flex flex-col gap-px p-1.5" ref={listRef} role="listbox">
      {groups.map((group) => (
        <div aria-label={group.label} className="flex flex-col gap-px" key={group.id} role="group">
          {group.label ? (
            <div
              aria-hidden="true"
              className="flex h-7 items-center gap-1.5 pr-2.5 text-[11px] font-medium text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]"
              style={{ paddingLeft: `${8 + group.depth * indentPx}px` }}
            >
              <svg className="size-3 shrink-0 opacity-60" fill="none" viewBox="0 0 256 256">
                <path d="M58 93L125.879 160.879C127.05 162.05 128.95 162.05 130.121 160.879L198 93" stroke="currentColor" strokeLinecap="round" strokeWidth="24" />
              </svg>
              <span className="truncate">{group.label}</span>
            </div>
          ) : null}
          {group.items.map((item) => {
            const selected = item.id === selectedId;

            return (
              <div
                aria-selected={selected}
                className={cn(
                  "group/layer grid h-8 cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-center gap-1.5 rounded-lg border border-transparent pr-2.5 outline-none select-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:-outline-offset-2 focus-visible:outline-[color:var(--ring)]",
                  selected
                    ? "bg-[color:color-mix(in_oklab,var(--accent)_20%,transparent)]"
                    : "hover:bg-[color:color-mix(in_oklab,var(--foreground)_8%,transparent)]",
                )}
                data-layer-id={item.id}
                key={item.id}
                onClick={() => onSelect(item.id)}
                onKeyDown={(event) => onKeyDown(event, item.id)}
                role="option"
                style={{ paddingLeft: `${7 + item.depth * indentPx}px` }}
                tabIndex={selected ? 0 : -1}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span aria-hidden="true" className={cn("flex size-3.5 shrink-0 items-center justify-center [&_svg]:size-3.5", item.muted ? "text-[color:color-mix(in_oklab,var(--foreground)_48%,transparent)]" : "text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]")}>
                    {item.icon}
                  </span>
                  {/* Muted rows dim by color, not opacity, so their text keeps AA contrast. */}
                  <span className={cn("truncate font-mono text-xs", item.muted ? "text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]" : "text-[color:var(--foreground)]")} title={item.name}>
                    {item.name}
                  </span>
                </span>
                <span className="flex items-center gap-1.5">
                  {item.status}
                  {item.meta ? (
                    <span className="font-mono text-[11px] tabular-nums text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">{item.meta}</span>
                  ) : null}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
