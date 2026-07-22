"use client";

import { useEffect, useState } from "react";
import { useTheme } from "fumadocs-ui/provider/base";
import type { ComponentProps } from "react";

import { Moon, Sun } from "@/components/icon";
import { cn } from "@/lib/cn";

export function ThemeToggle({ className }: Pick<ComponentProps<"button">, "className">) {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = mounted && resolvedTheme === "dark";
  const nextTheme = isDark ? "light" : "dark";
  const Icon = isDark ? Sun : Moon;

  return (
    <button
      aria-label={`Switch to ${nextTheme} mode`}
      className={cn(
        "inline-flex size-7 items-center justify-center rounded-md text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-primary",
        className,
      )}
      onClick={() => setTheme(nextTheme)}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4.5" strokeWidth={2} />
    </button>
  );
}
