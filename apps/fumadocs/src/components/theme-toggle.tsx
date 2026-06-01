"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { useTheme } from "fumadocs-ui/provider/base";

export function ThemeToggle() {
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
      className="inline-flex size-9 items-center justify-center rounded-full border border-fd-border bg-fd-background text-fd-muted-foreground transition hover:bg-fd-accent hover:text-fd-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fd-primary"
      onClick={() => setTheme(nextTheme)}
      type="button"
    >
      <Icon aria-hidden="true" className="size-4" strokeWidth={2} />
    </button>
  );
}
