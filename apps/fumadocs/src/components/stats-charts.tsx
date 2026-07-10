import { useTheme } from "fumadocs-ui/provider/base";
import { RotateCcw } from "lucide-react";
import { type ReactNode, useEffect, useState } from "react";

import {
  ActiveDot,
  Area,
  AreaChart,
  type BloomLevel,
  type ChartConfig,
  type DitherColor,
  Grid,
  Legend,
  Pie,
  PieChart,
  Radar,
  RadarChart,
  Sparkline,
  Tooltip,
  XAxis,
  YAxis,
} from "@/components/dither-kit";
import type { DailyDownloads, VersionDownloads } from "@/lib/stats-runtime";

const numberFormat = new Intl.NumberFormat("en-US");

function formatDay(iso: string) {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

// Bloom is an additive glow — gorgeous on the dark theme, but on a light
// background it washes the fill toward pale cyan. Only glow in the dark.
function useBloom(): BloomLevel {
  const { resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted && resolvedTheme === "dark" ? "low" : "off";
}

// The tweak-panel "Desktop / Mobile Variant" idea: the gradient fade reads best
// with room to breathe, the hatched weave stays legible on a narrow canvas.
function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    const query = window.matchMedia("(max-width: 640px)");
    setNarrow(query.matches);
    const onChange = (event: MediaQueryListEvent) => setNarrow(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return narrow;
}

export function StatCard({
  label,
  value,
  spark,
  sparkColor = "blue",
  hint,
}: {
  label: string;
  value: number | null;
  spark?: number[];
  sparkColor?: DitherColor;
  hint?: string;
}) {
  const bloom = useBloom();
  return (
    <div className="flex flex-col justify-between gap-3 rounded-lg border border-fd-border bg-fd-card p-4">
      <div className="flex items-baseline justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-fd-muted-foreground">{label}</p>
          <p className="mt-1 font-mono text-3xl text-fd-foreground tabular-nums">
            {value === null ? "—" : numberFormat.format(value)}
          </p>
        </div>
        {hint && <p className="text-xs text-fd-muted-foreground">{hint}</p>}
      </div>
      {spark && spark.length > 1 && (
        <div className="h-10">
          <Sparkline bloom={bloom} bloomOnHover color={sparkColor} data={spark} />
        </div>
      )}
    </div>
  );
}

export function ChartCard({ children, title }: { children: ReactNode; title: string }) {
  return (
    <section className="rounded-lg border border-fd-border bg-fd-card p-4">
      <h2 className="text-sm font-medium text-fd-foreground">{title}</h2>
      {children}
    </section>
  );
}

const downloadsConfig: ChartConfig = { downloads: { label: "Downloads", color: "blue" } };

export function DownloadsChart({ data }: { data: DailyDownloads[] }) {
  const [replayToken, setReplayToken] = useState(0);
  const narrow = useIsNarrow();
  const bloom = useBloom();
  const rows = data.map((entry) => ({ ...entry, label: formatDay(entry.day) }));

  return (
    <section className="relative rounded-lg border border-fd-border bg-fd-card p-4">
      <h2 className="text-sm font-medium text-fd-foreground">Daily downloads on npm</h2>
      <button
        aria-label="Replay chart animation"
        className="absolute top-3 right-3 rounded-md border border-fd-border p-1.5 text-fd-muted-foreground transition-colors hover:bg-fd-accent hover:text-fd-accent-foreground"
        onClick={() => setReplayToken((token) => token + 1)}
        type="button"
      >
        <RotateCcw className="size-3.5" />
      </button>
      <div className="mt-3 h-72 md:h-80">
        {/* The canvas paints with the config captured when its entrance sweep
            starts, so remount when the narrow flag settles after hydration. */}
        <AreaChart
          key={narrow ? "narrow" : "wide"}
          animationDuration={900}
          bloom={bloom}
          config={downloadsConfig}
          data={rows}
          replayToken={replayToken}
        >
          <Grid />
          <XAxis
            dataKey="day"
            maxTicks={narrow ? 4 : 8}
            tickFormatter={(value) => formatDay(String(value))}
          />
          <YAxis />
          <Area dataKey="downloads" variant={narrow ? "hatched" : "gradient"}>
            <ActiveDot />
          </Area>
          <Tooltip labelKey="label" variant="frosted-glass" />
        </AreaChart>
      </div>
    </section>
  );
}

const versionColors: DitherColor[] = ["blue", "purple", "green", "orange", "pink"];

export function VersionsDonut({ data }: { data: VersionDownloads[] }) {
  const bloom = useBloom();
  const config: ChartConfig = {};
  let colorIndex = 0;
  for (const entry of data) {
    config[entry.version] =
      entry.version === "other"
        ? { label: "other", color: "grey" }
        : {
            label: `v${entry.version}`,
            color: versionColors[colorIndex++ % versionColors.length],
          };
  }
  const total = data.reduce((sum, entry) => sum + entry.downloads, 0);

  return (
    <div className="relative mt-3 h-64">
      <PieChart
        bloom={bloom}
        bloomOnHover
        config={config}
        data={data}
        dataKey="downloads"
        innerRadius={0.62}
        // Reserve headroom for the legend rows the absolute Legend renders.
        margins={{ top: 40 }}
        nameKey="version"
      >
        <Pie variant="gradient" />
        <Legend align="right" />
        <Tooltip variant="frosted-glass" />
      </PieChart>
      {/* Donut-hole label; offset to the ring's center (its top margin is 40px). */}
      <div
        className="pointer-events-none absolute inset-x-0 mx-auto max-w-32 text-center"
        style={{ top: "calc(50% + 20px)", transform: "translateY(-50%)" }}
      >
        <p className="font-mono text-xl text-fd-foreground tabular-nums md:text-2xl">
          {numberFormat.format(total)}
        </p>
        <p className="text-[10px] text-fd-muted-foreground uppercase tracking-wide">per week</p>
      </div>
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const weekdayConfig: ChartConfig = { downloads: { label: "Avg downloads", color: "green" } };

/** Average downloads per weekday — shows the workday-vs-weekend install rhythm. */
export function WeekdayRadar({ data }: { data: DailyDownloads[] }) {
  const bloom = useBloom();
  const totals = WEEKDAYS.map(() => ({ sum: 0, days: 0 }));
  for (const entry of data) {
    // getUTCDay: 0 = Sunday; rotate so the axes run Mon..Sun.
    const index = (new Date(`${entry.day}T00:00:00Z`).getUTCDay() + 6) % 7;
    totals[index].sum += entry.downloads;
    totals[index].days += 1;
  }
  const rows = WEEKDAYS.map((weekday, index) => ({
    weekday,
    downloads: totals[index].days === 0 ? 0 : Math.round(totals[index].sum / totals[index].days),
  }));

  return (
    <div className="mt-3 h-64">
      <RadarChart bloom={bloom} config={weekdayConfig} data={rows} nameKey="weekday">
        <Radar dataKey="downloads" variant="gradient" />
        <Tooltip variant="frosted-glass" />
      </RadarChart>
    </div>
  );
}
