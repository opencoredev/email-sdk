/**
 * Adapted from Toolcraft (https://toolcraft.sh, MIT): ui/components/primitives/button.tsx and
 * ui/components/panel/panel-icon-button.tsx. See NOTICE.md.
 */
import type { ComponentProps } from "react";

import { cn } from "@/lib/cn";

export type ButtonVariant = "ghost" | "outline";

export type ButtonSize = "default" | "icon" | "icon-sm";

const base =
  "inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-md text-xs font-medium whitespace-nowrap outline-none transition-[background-color,color,scale] duration-150 ease-out select-none active:scale-[0.96] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5";

const variants: Record<ButtonVariant, string> = {
  ghost:
    "bg-transparent text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)] hover:bg-[color:color-mix(in_oklab,var(--foreground)_10%,transparent)] hover:text-[color:var(--foreground)] aria-pressed:text-[color:var(--foreground)]",
  outline:
    "border border-[color:color-mix(in_oklab,var(--border)_14%,transparent)] bg-[color:color-mix(in_oklab,var(--input)_4%,transparent)] text-[color:color-mix(in_oklab,var(--foreground)_80%,transparent)] hover:bg-[color:color-mix(in_oklab,var(--foreground)_10%,transparent)] hover:text-[color:var(--foreground)]",
};

const sizes: Record<ButtonSize, string> = {
  default: "h-7 px-2.5",
  icon: "size-7",
  "icon-sm": "size-6",
};

export type ButtonProps = ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize };

export function Button({ className, variant = "ghost", size = "default", type = "button", ...props }: ButtonProps) {
  return <button className={cn(base, variants[variant], sizes[size], className)} data-slot="button" type={type} {...props} />;
}

/** An icon-only button. `label` is its accessible name and its tooltip. */
export function IconButton({ label, ...props }: Omit<ButtonProps, "aria-label" | "title"> & { label: string }) {
  return <Button aria-label={label} size="icon" title={label} {...props} />;
}
