import { useEffect, useState } from "react";

import { getStats, type StatsSnapshot } from "../lib/npm-stats";
import { ChartCard, DownloadsChart, StatCard, VersionsDonut, WeekdayRadar } from "./stats-charts";

// The /stats body. It loads the numbers from the npm registry in the browser,
// so a static build always shows current downloads.
export function NpmStats() {
  const [stats, setStats] = useState<StatsSnapshot | null>(null);

  useEffect(() => {
    let cancelled = false;

    void getStats().then((snapshot) => {
      if (!cancelled) setStats(snapshot);
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (!stats) {
    return (
      <p className="not-prose my-6 text-sm text-fd-muted-foreground" role="status">
        Loading download numbers from npm…
      </p>
    );
  }

  const allTimeSpark = stats.dailyDownloads?.map((entry) => entry.downloads);
  const weekSpark = stats.dailyDownloads?.slice(-7).map((entry) => entry.downloads);

  return (
    <div className="not-prose my-6">
      <div className="grid gap-3 md:grid-cols-2">
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
            Download numbers are momentarily unavailable. Try again in a few minutes.
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
    </div>
  );
}
