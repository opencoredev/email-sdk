/**
 * Adapted from Toolcraft (https://toolcraft.sh, MIT): ui/components/primitives/switch.tsx, with
 * Base UI's Switch replaced by a native `role="switch"` button. See NOTICE.md.
 */
import { useId } from "react";

import { cn } from "@/lib/cn";

export type SwitchProps = { checked: boolean; onCheckedChange: (checked: boolean) => void; label: string; className?: string };

export function Switch({ checked, onCheckedChange, label, className }: SwitchProps) {
  const id = useId();

  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <button
        aria-checked={checked}
        className="group/switch relative inline-flex h-4 w-7 shrink-0 cursor-pointer items-center rounded-full p-px outline-none transition-[background-color] duration-150 ease-out after:absolute after:-inset-x-3 after:-inset-y-2 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)] aria-checked:bg-[color:var(--accent)] not-aria-checked:bg-[color:color-mix(in_oklab,var(--input)_22%,transparent)]"
        id={id}
        onClick={() => onCheckedChange(!checked)}
        role="switch"
        type="button"
      >
        <span
          aria-hidden="true"
          className="pointer-events-none block size-3.5 rounded-full bg-[color:var(--background)] transition-transform duration-150 ease-out group-aria-checked/switch:translate-x-[calc(100%-2px)]"
        />
      </button>
      <label className="cursor-pointer text-xs text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)] select-none" htmlFor={id}>
        {label}
      </label>
    </span>
  );
}
