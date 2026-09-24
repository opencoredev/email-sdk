import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const statsPackageName = "@opencoredev/email-sdk";

// First day with download data on the npm API (v0.1.0 published 2026-05-30).
const FIRST_PUBLISH_DAY = "2026-05-30";

export type DailyDownloads = { day: string; downloads: number };

export type VersionDownloads = { version: string; downloads: number };

export type StatsSnapshot = {
  packageName: string;
  dailyDownloads: DailyDownloads[] | null;
  totalDownloads: number | null;
  lastWeekDownloads: number | null;
  versionDownloads: VersionDownloads[] | null;
  fetchedAt: string;
};

const dailyDownloadsSchema = z.object({
  downloads: z.array(z.object({ day: z.string(), downloads: z.number() })).optional(),
});

const versionDownloadsSchema = z.object({
  downloads: z.record(z.string(), z.number()).optional(),
});

async function fetchJson<Schema extends z.ZodType>(
  url: string,
  schema: Schema,
): Promise<z.infer<Schema> | null> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });

    if (!response.ok) return null;
    const parsed = schema.safeParse(await response.json());

    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function fetchDailyDownloads(): Promise<DailyDownloads[] | null> {
  const today = new Date().toISOString().slice(0, 10);

  const data = await fetchJson(
    `https://api.npmjs.org/downloads/range/${FIRST_PUBLISH_DAY}:${today}/${encodeURIComponent(statsPackageName)}`,
    dailyDownloadsSchema,
  );

  if (!data?.downloads || data.downloads.length === 0) return null;
  // npm reports zeros for the most recent day(s) it hasn't aggregated yet —
  // trim them so the chart doesn't end on a false cliff.
  let end = data.downloads.length;

  while (end > 0 && data.downloads[end - 1].downloads === 0) end -= 1;

  if (end === 0) return null;

  return data.downloads.slice(0, end).map(({ day, downloads }) => ({ day, downloads }));
}

// Per-version downloads over the last week, condensed to the top versions plus
// an "other" bucket so the donut stays readable.
async function fetchVersionDownloads(): Promise<VersionDownloads[] | null> {
  const data = await fetchJson(
    `https://api.npmjs.org/versions/${encodeURIComponent(statsPackageName)}/last-week`,
    versionDownloadsSchema,
  );

  if (!data?.downloads) return null;

  const entries = Object.entries(data.downloads)
    .map(([version, downloads]) => ({ version, downloads }))
    .filter((entry) => entry.downloads > 0)
    .sort((a, b) => b.downloads - a.downloads);

  if (entries.length === 0) return null;

  const top = entries.slice(0, 4);
  const rest = entries.slice(4).reduce((sum, entry) => sum + entry.downloads, 0);

  if (rest > 0) top.push({ version: "other", downloads: rest });

  return top;
}

export const getStatsServerFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<StatsSnapshot> => {
    const [dailyDownloads, versionDownloads] = await Promise.all([
      fetchDailyDownloads(),
      fetchVersionDownloads(),
    ]);

    return {
      packageName: statsPackageName,
      dailyDownloads,
      totalDownloads: dailyDownloads?.reduce((sum, entry) => sum + entry.downloads, 0) ?? null,
      lastWeekDownloads:
        dailyDownloads?.slice(-7).reduce((sum, entry) => sum + entry.downloads, 0) ?? null,
      versionDownloads,
      fetchedAt: new Date().toISOString(),
    };
  },
);
