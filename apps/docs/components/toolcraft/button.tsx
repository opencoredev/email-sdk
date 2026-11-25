/**
 * Adapted from Toolcraft (https://toolcraft.sh, MIT): ui/components/primitives/button.tsx and
 * ui/components/panel/panel-icon-button.tsx. See NOTICE.md.
 */
import type { ComponentProps } from "react";

import { cn } from "./cn";

export type ButtonSize = "icon" | "icon-sm";

const base =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-transparent text-xs font-medium whitespace-nowrap text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)] outline-none transition-[background-color,color,scale] duration-150 ease-out select-none hover:bg-[color:color-mix(in_oklab,var(--foreground)_10%,transparent)] hover:text-[color:var(--foreground)] active:scale-[0.96] aria-pressed:text-[color:var(--foreground)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5";

const sizes: Record<ButtonSize, string> = {
  icon: "size-7",
  "icon-sm": "size-6",
};

export type ButtonProps = ComponentProps<"button"> & { size?: ButtonSize };

function Button({ className, size = "icon", type = "button", ...props }: ButtonProps) {
  return <button className={cn(base, sizes[size], className)} data-slot="button" type={type} {...props} />;
}

/** An icon-only button. `label` is its accessible name and its tooltip. */
export function IconButton({ label, ...props }: Omit<ButtonProps, "aria-label" | "title"> & { label: string }) {
  return <Button aria-label={label} title={label} {...props} />;
}
