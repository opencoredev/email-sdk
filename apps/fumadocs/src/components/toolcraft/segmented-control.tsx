/**
 * Adapted from Toolcraft (https://toolcraft.sh, MIT): ui/components/controls/segmented and the
 * outline toggle-group primitive it renders. Base UI's ToggleGroup is replaced by a native
 * radio group with roving focus. See NOTICE.md.
 */
import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

import { cn } from "@/lib/cn";

export type SegmentedControlOption<TValue extends string> = { value: TValue; label: string; icon?: ReactNode };

export type SegmentedControlProps<TValue extends string> = {
  ariaLabel: string;
  options: readonly SegmentedControlOption<TValue>[];
  value: TValue;
  onValueChange: (value: TValue) => void;
  className?: string;
};

const item =
  "relative inline-flex h-7 min-w-0 flex-1 cursor-pointer items-center justify-center gap-1.5 border border-[color:color-mix(in_oklab,var(--border)_14%,transparent)] bg-[color:color-mix(in_oklab,var(--input)_4%,transparent)] px-2.5 text-xs font-medium whitespace-nowrap text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)] outline-none transition-[background-color,color] duration-150 ease-out not-last:border-r-0 first:rounded-l-md last:rounded-r-md hover:bg-[color:color-mix(in_oklab,var(--foreground)_8%,transparent)] hover:text-[color:var(--foreground)] focus-visible:z-10 focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-1 focus-visible:outline-[color:var(--ring)] aria-checked:bg-[color:color-mix(in_oklab,var(--accent)_16%,transparent)] aria-checked:text-[color:var(--foreground)] [&_svg]:size-3.5 [&_svg]:shrink-0";

export function SegmentedControl<TValue extends string>({ ariaLabel, options, value, onValueChange, className }: SegmentedControlProps<TValue>) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;

    if (step === 0) return;

    event.preventDefault();

    const next = (index + step + options.length) % options.length;
    const option = options[next];

    if (!option) return;

    onValueChange(option.value);
    refs.current[next]?.focus();
  }

  return (
    <div aria-label={ariaLabel} className={cn("flex w-fit items-center", className)} data-slot="segmented-control" role="radiogroup">
      {options.map((option, index) => {
        const checked = option.value === value;

        return (
          <button
            aria-checked={checked}
            className={item}
            key={option.value}
            onClick={() => onValueChange(option.value)}
            onKeyDown={(event) => onKeyDown(event, index)}
            ref={(element) => {
              refs.current[index] = element;
            }}
            role="radio"
            tabIndex={checked ? 0 : -1}
            type="button"
          >
            {option.icon}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
