import { createFileRoute } from "@tanstack/react-router";
import { HomeLayout } from "fumadocs-ui/layouts/home";

import {
  ChartCard,
  DownloadsChart,
  StatCard,
  VersionsDonut,
  WeekdayRadar,
} from "@/components/stats-charts";
import { baseOptions } from "@/lib/layout.shared";
import { appName, siteUrl } from "@/lib/shared";
import { getStatsServerFn, statsPackageName } from "@/lib/stats-runtime";

export const Route = createFileRoute("/stats")({
  head: () => ({
    meta: [
      { title: `Stats - ${appName}` },
      {
        name: "description",
        content: `Live npm download numbers for ${statsPackageName}, updated hourly.`,
      },
      { property: "og:title", content: `Stats - ${appName}` },
      {
        property: "og:description",
        content: `Live npm download numbers for ${statsPackageName}, updated hourly.`,
      },
      { property: "og:url", content: `${siteUrl}/stats` },
    ],
    links: [{ rel: "canonical", href: `${siteUrl}/stats` }],
  }),
  loader: () => getStatsServerFn(),
  // Rendered on demand (excluded from prerender in vite.config.ts); the edge
  // cache keeps it fast and refreshes the numbers about once an hour.
  headers: () => ({
    "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400",
  }),
  component: Stats,
});

function Stats() {
  const stats = Route.useLoaderData();
  const allTimeSpark = stats.dailyDownloads?.map((entry) => entry.downloads);
  const weekSpark = stats.dailyDownloads?.slice(-7).map((entry) => entry.downloads);

  return (
    <HomeLayout {...baseOptions()}>
      <main className="border-b border-fd-border bg-fd-background text-fd-foreground">
        <article className="mx-auto max-w-5xl px-6 py-14 md:px-10 lg:px-14">
          <h1 className="text-4xl font-medium leading-tight md:text-5xl">Email SDK Stats</h1>

          <div className="mt-10 grid gap-3 md:grid-cols-2">
            <StatCard
              hint="since first publish"
              label="Total downloads"
              spark={allTimeSpark}
              value={stats.totalDownloads}
            />
            <StatCard
              hint="last 7 days"
              label="Downloads last week"
              spark={weekSpark}
              value={stats.lastWeekDownloads}
            />
          </div>

          <div className="mt-6 space-y-6">
            {stats.dailyDownloads && stats.dailyDownloads.length > 1 ? (
              <DownloadsChart data={stats.dailyDownloads} />
            ) : (
              <p className="text-sm text-fd-muted-foreground">
                Download numbers are momentarily unavailable — try again in a few minutes.
              </p>
            )}

            <div className="grid gap-6 md:grid-cols-2">
              {stats.versionDownloads && stats.versionDownloads.length > 0 && (
                <ChartCard title="Downloads by version, last week">
                  <VersionsDonut data={stats.versionDownloads} />
                </ChartCard>
              )}
              {stats.dailyDownloads && stats.dailyDownloads.length >= 7 && (
                <ChartCard title="Average downloads by weekday">
                  <WeekdayRadar data={stats.dailyDownloads} />
                </ChartCard>
              )}
            </div>
          </div>

          <p className="mt-8 border-t border-fd-border pt-6 text-xs leading-6 text-fd-muted-foreground">
            Data from the{" "}
            <a
              className="text-fd-primary underline-offset-4 hover:underline"
              href={`https://www.npmjs.com/package/${statsPackageName}`}
              rel="noreferrer"
              target="_blank"
            >
              npm registry
            </a>
            , refreshed about once an hour. Charts rendered with{" "}
            <a
              className="text-fd-primary underline-offset-4 hover:underline"
              href="https://www.tripwire.sh/dither-kit"
              rel="noreferrer"
              target="_blank"
            >
              dither-kit
            </a>
            {" "}by{" "}
            <a
              className="text-fd-primary underline-offset-4 hover:underline"
              href="https://x.com/grimcodes"
              rel="noreferrer"
              target="_blank"
            >
              @grimcodes
            </a>
            .
          </p>
        </article>
      </main>
    </HomeLayout>
  );
}
