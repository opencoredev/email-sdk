/**
 * Adapted from Toolcraft (https://toolcraft.sh, MIT): the panel surface and
 * ui/components/control-layout/control-section-title.tsx. See NOTICE.md.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export type PanelProps = { title: string; actions?: ReactNode; children: ReactNode; className?: string; bodyClassName?: string };

/** A titled editor panel: Layers, Controls, Timeline. */
export function Panel({ title, actions, children, className, bodyClassName }: PanelProps) {
  return (
    <section aria-label={title} className={cn("flex min-h-0 min-w-0 flex-col bg-[color:var(--panel)]", className)} data-slot="panel">
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-[color:color-mix(in_oklab,var(--border)_10%,transparent)] pr-1.5 pl-3">
        <h2 className="m-0 min-w-0 flex-1 truncate text-xs font-semibold text-[color:var(--foreground)]" data-slot="panel-title">
          {title}
        </h2>
        {actions}
      </header>
      <div className={cn("min-h-0 flex-1 overflow-auto", bodyClassName)}>{children}</div>
    </section>
  );
}

/** A section heading inside a panel, in Toolcraft's small muted style. */
export function ControlSectionTitle({ children }: { children: ReactNode }) {
  return (
    <h3 className="m-0 mb-2 text-[11px] font-medium tracking-wide text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)] uppercase">
      {children}
    </h3>
  );
}

/** One label/value row of a controls panel. */
export function ControlRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[72px_minmax(0,1fr)] items-baseline gap-3 py-1 text-xs">
      <dt className="text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">{label}</dt>
      <dd className="m-0 min-w-0 break-words text-[color:var(--foreground)]">{children}</dd>
    </div>
  );
}
