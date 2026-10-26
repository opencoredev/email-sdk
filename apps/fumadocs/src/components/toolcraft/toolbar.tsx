/**
 * Adapted from Toolcraft (https://toolcraft.sh, MIT): runtime/react/app-shell/toolbar-panel.tsx.
 * See NOTICE.md.
 */
import type { ReactNode } from "react";

import { cn } from "@/lib/cn";

export function Toolbar({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div aria-label={label} className={cn("flex min-h-11 flex-wrap items-center gap-2 px-2 py-1.5", className)} data-slot="toolbar" role="group">
      {children}
    </div>
  );
}

export function ToolbarDivider() {
  return <span aria-hidden="true" className="block h-5 w-px shrink-0 rounded-full bg-[color:color-mix(in_oklab,var(--border)_14%,transparent)]" />;
}
