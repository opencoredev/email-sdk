// The pure half of scripts/patch-vercel-config.ts: given the Build Output API
// routes `blume build` wrote, return them with the site's security headers,
// Markdown Content-Type, homepage Link header, archived index.md redirects,
// and the /?mode=agent rewrite added. Applying it twice changes nothing.
import { z } from "zod";

import { siteUrl } from "./shared";
import {
  agentModeRoute,
  discoveryLink,
  headerRoutes,
  homeAlternatesLink,
  type VercelRoute,
} from "./vercel-headers";

export const vercelRouteSchema = z.looseObject({
  src: z.string().optional(),
  dest: z.string().optional(),
  handle: z.string().optional(),
  status: z.number().optional(),
  continue: z.boolean().optional(),
  has: z
    .array(z.looseObject({ type: z.string(), key: z.string(), value: z.string().optional() }))
    .optional(),
  headers: z.record(z.string(), z.string()).optional(),
});

export type ParsedRoute = z.infer<typeof vercelRouteSchema>;

export const vercelConfigSchema = z.looseObject({
  routes: z.array(vercelRouteSchema),
});

function linkHeaderKey(entry: string): string {
  const urlMatch = /^<([^>]+)>/i.exec(entry);
  const relMatch = /;\s*rel=(?:"([^"]+)"|([^;\s]+))/i.exec(entry);

  if (urlMatch) {
    const rel = (relMatch?.[1] ?? relMatch?.[2] ?? "").toLowerCase();

    return `${urlMatch[1]?.toLowerCase() ?? ""}|${rel}`;
  }

  return entry.toLowerCase();
}

function splitLinkHeaderEntries(header: string): string[] {
  const entries: string[] = [];
  let start = 0;
  let inAngle = false;
  let inQuotes = false;

  for (let index = 0; index < header.length; index += 1) {
    const ch = header[index];

    if (ch === '"' && !inAngle) {
      inQuotes = !inQuotes;
    } else if (!inQuotes && ch === "<") {
      inAngle = true;
    } else if (!inQuotes && ch === ">") {
      inAngle = false;
    } else if (!inAngle && !inQuotes && ch === ",") {
      entries.push(header.slice(start, index));
      start = index + 1;
    }
  }

  entries.push(header.slice(start));

  return entries;
}

/** Merge two Link headers, keeping the first entry for each URL and rel. */
export function mergeLinkHeaders(primary: string, existing: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const raw of [...splitLinkHeaderEntries(primary), ...splitLinkHeaderEntries(existing)]) {
    const entry = raw.trim();

    if (!entry) continue;

    const key = linkHeaderKey(entry);

    if (seen.has(key)) continue;

    seen.add(key);
    parts.push(entry);
  }

  return parts.join(", ");
}

const archivedIndexMdRedirects: VercelRoute[] = [
  {
    src: "^/docs/v/(\\d+\\.\\d+\\.\\d+)/(.+)/index\\.md$",
    headers: { Location: "/v$1/docs/$2.md" },
    status: 308,
  },
  {
    src: "^/(v\\d+\\.\\d+\\.\\d+/docs/.+)/index\\.md$",
    headers: { Location: "/$1.md" },
    status: 308,
  },
];

export const markdownContentTypeRoute: ParsedRoute = {
  src: "^/.*\\.md$",
  headers: {
    "Content-Type": "text/markdown; charset=utf-8",
  },
  continue: true,
};

const homeLinkMerged = `${discoveryLink}, ${homeAlternatesLink}`;

function routeSignature(route: ParsedRoute): string {
  const sortedHeaders = route.headers
    ? Object.entries(route.headers).toSorted(([a], [b]) => a.localeCompare(b))
    : undefined;

  return JSON.stringify({
    src: route.src ?? null,
    dest: route.dest ?? null,
    handle: route.handle ?? null,
    status: route.status ?? null,
    continue: route.continue ?? null,
    has: route.has ?? null,
    headers: sortedHeaders ?? null,
  });
}

function isHomeLinkRoute(route: ParsedRoute): boolean {
  return (
    route.src === "^/$" &&
    route.headers !== undefined &&
    ("link" in route.headers || "Link" in route.headers)
  );
}

export type VercelRoutesPatch =
  | { kind: "unchanged" }
  | { kind: "changed"; routes: ParsedRoute[]; added: number };

/**
 * Add the site routes to the routes `blume build` generated. `indexTokenCount`
 * is the curated /index.md's token estimate, written to its
 * `x-markdown-tokens` header when given.
 */
export function patchVercelRoutes({
  routes,
  indexTokenCount,
}: {
  routes: readonly ParsedRoute[];
  indexTokenCount?: string;
}): VercelRoutesPatch {
  if (!routes.some((route) => route.handle === "filesystem")) {
    throw new Error("config.json has no filesystem handler; the routes can't be placed.");
  }

  const syncedRoutes = routes.map((route) => {
    if (
      indexTokenCount !== undefined &&
      route.dest === "/index.md" &&
      route.headers &&
      "x-markdown-tokens" in route.headers
    ) {
      return { ...route, headers: { ...route.headers, "x-markdown-tokens": indexTokenCount } };
    }

    if (isHomeLinkRoute(route) && route.headers) {
      const existing = route.headers.Link ?? route.headers.link ?? "";
      const { link: _lowercaseLink, Link: _titleLink, ...restHeaders } = route.headers;

      return {
        ...route,
        headers: { ...restHeaders, Link: mergeLinkHeaders(homeLinkMerged, existing) },
      };
    }

    return route;
  });

  const existingSignatures = new Set(syncedRoutes.map((route) => routeSignature(route)));

  const missingSiteRoutes = [
    ...headerRoutes,
    markdownContentTypeRoute,
    ...(syncedRoutes.some(isHomeLinkRoute)
      ? []
      : [{ src: "^/$", headers: { Link: homeLinkMerged }, continue: true }]),
    ...archivedIndexMdRedirects,
    agentModeRoute,
  ].filter((route) => !existingSignatures.has(routeSignature(route)));

  if (missingSiteRoutes.length === 0 && JSON.stringify(syncedRoutes) === JSON.stringify(routes)) {
    return { kind: "unchanged" };
  }

  return {
    kind: "changed",
    routes: [...missingSiteRoutes, ...syncedRoutes],
    added: missingSiteRoutes.length,
  };
}

/**
 * Replace the per-version link sections Blume writes into llms.txt with one
 * short "Archived versions" list, keeping any later non-archived sections.
 */
export function trimArchivedLlms(llms: string, versionIds: readonly string[]): string {
  const archivedHeadingIndex = llms.search(/^## v\d+\.\d+\.\d+ \(archived\)$/m);

  if (archivedHeadingIndex === -1) return llms;

  const afterArchived = llms.slice(archivedHeadingIndex);
  const nextNonArchivedOffset = afterArchived.search(/^## (?!v\d+\.\d+\.\d+ \(archived\)$).+$/m);

  const trailing =
    nextNonArchivedOffset === -1
      ? ""
      : `\n${afterArchived.slice(nextNonArchivedOffset).trimStart()}`;

  const summaryLines = versionIds.map(
    (id) => `- [${id}](${siteUrl}/${id}/docs): archived documentation`,
  );

  return (
    [
      llms.slice(0, archivedHeadingIndex).trimEnd(),
      "",
      "## Archived versions",
      "",
      ...summaryLines,
      "",
    ].join("\n") + trailing
  );
}

/**
 * Date the sitemap entries Blume leaves undated. It dates content pages from
 * their front matter, but not custom pages like the homepage and the /blog
 * index: the blog index takes its newest post's date, the homepage the date
 * passed in. A loc that already has a <lastmod> keeps it.
 */
export function dateCustomPages(sitemap: string, homeLastmod: string | undefined): string {
  const postDates = [...sitemap.matchAll(/<loc>[^<]+\/blog\/[^<]+<\/loc><lastmod>([^<]+)<\/lastmod>/g)]
    .map((match) => match[1] ?? "")
    .toSorted();

  const lastmods = new Map([
    [`${siteUrl}/`, homeLastmod],
    [`${siteUrl}/blog`, postDates.at(-1)],
  ]);

  return sitemap.replaceAll(/<url><loc>([^<]+)<\/loc><\/url>/g, (url, loc: string) => {
    const lastmod = lastmods.get(loc);

    return lastmod ? `<url><loc>${loc}</loc><lastmod>${lastmod}</lastmod></url>` : url;
  });
}
