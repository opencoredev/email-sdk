// Splices the site's security headers and the /?mode=agent rewrite
// (lib/vercel-headers.ts) into the Build Output API config `blume build`
// writes for Vercel. Runs after the build; a second run changes nothing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { siteUrl } from "../lib/shared";
import {
  agentModeRoute,
  discoveryLink,
  headerRoutes,
  homeAlternatesLink,
  type VercelRoute,
} from "../lib/vercel-headers";
import { archivedDocsVersions } from "../lib/versions";

const docsDir = join(import.meta.dirname, "..");

const configPath = join(docsDir, ".vercel/output/config.json");

const staticDir = join(docsDir, ".vercel/output/static");

const curatedIndexMdPath = join(docsDir, "lib/index.md");

const builtIndexMdPath = join(staticDir, "index.md");

const builtLlmsTxtPath = join(staticDir, "llms.txt");

if (!existsSync(configPath)) {
  console.error(`[vercel] ${configPath} is missing. Run \`blume build\` first.`);
  process.exit(1);
}

const configSchema = z.looseObject({
  routes: z.array(
    z.looseObject({
      src: z.string().optional(),
      dest: z.string().optional(),
      handle: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    }),
  ),
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

function mergeLinkHeaders(primary: string, existing: string): string {
  const seen = new Set<string>();
  const parts: string[] = [];

  for (const raw of `${primary}, ${existing}`.split(",")) {
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

const config = configSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));

// Keep /index.md at the curated ~2 KB homepage summary and sync x-markdown-tokens.
const curatedIndexMd = existsSync(curatedIndexMdPath)
  ? readFileSync(curatedIndexMdPath, "utf8")
  : undefined;

if (curatedIndexMd !== undefined) {
  writeFileSync(builtIndexMdPath, curatedIndexMd);
}

const indexTokenCount =
  curatedIndexMd !== undefined
    ? String(Math.ceil(Buffer.byteLength(curatedIndexMd) / 4))
    : undefined;

// Trim archived version link sections from llms.txt while preserving any later non-archived sections.
if (existsSync(builtLlmsTxtPath)) {
  const llms = readFileSync(builtLlmsTxtPath, "utf8");
  const archivedHeadingIndex = llms.search(/^## v\d+\.\d+\.\d+ \(archived\)$/m);

  if (archivedHeadingIndex !== -1) {
    const afterArchived = llms.slice(archivedHeadingIndex);
    const nextNonArchivedOffset = afterArchived.search(/^## (?!v\d+\.\d+\.\d+ \(archived\)$).+$/m);

    const trailing =
      nextNonArchivedOffset === -1
        ? ""
        : `\n${afterArchived.slice(nextNonArchivedOffset).trimStart()}`;

    const summaryLines = archivedDocsVersions.map(
      (version) => `- [${version.id}](${siteUrl}/${version.id}/docs): archived documentation`,
    );

    const trimmed =
      [
        llms.slice(0, archivedHeadingIndex).trimEnd(),
        "",
        "## Archived versions",
        "",
        ...summaryLines,
        "",
      ].join("\n") + trailing;

    writeFileSync(builtLlmsTxtPath, trimmed);
  }
}

const homeLinkMerged = `${discoveryLink}, ${homeAlternatesLink}`;

const syncedRoutes = config.routes.map((route) => {
  if (
    indexTokenCount !== undefined &&
    route.dest === "/index.md" &&
    route.headers &&
    "x-markdown-tokens" in route.headers
  ) {
    return {
      ...route,
      headers: {
        ...route.headers,
        "x-markdown-tokens": indexTokenCount,
      },
    };
  }

  if (
    route.src === "^/$" &&
    route.headers &&
    ("link" in route.headers || "Link" in route.headers)
  ) {
    const existing = route.headers.Link ?? route.headers.link ?? "";
    const { link: _lowercaseLink, Link: _titleLink, ...restHeaders } = route.headers;

    return {
      ...route,
      headers: {
        ...restHeaders,
        Link: mergeLinkHeaders(homeLinkMerged, existing),
      },
    };
  }

  return route;
});

// Blume sets no Content-Security-Policy itself, so finding one means this
// script already ran on this build.
const alreadyPatched = syncedRoutes.some((route) =>
  JSON.stringify(route).includes("Content-Security-Policy"),
);

if (alreadyPatched) {
  const routesChanged = JSON.stringify(syncedRoutes) !== JSON.stringify(config.routes);

  if (routesChanged) {
    writeFileSync(
      configPath,
      `${JSON.stringify({ ...config, routes: syncedRoutes }, null, "\t")}\n`,
    );
  }

  console.log("[vercel] config.json already carries the site routes");
  process.exit(0);
}

const filesystemIndex = syncedRoutes.findIndex((route) => route.handle === "filesystem");

if (filesystemIndex === -1) {
  console.error("[vercel] config.json has no filesystem handler; the routes can't be placed.");
  process.exit(1);
}

const hasHomeLinkRoute = syncedRoutes.some(
  (route) =>
    route.src === "^/$" && route.headers && ("link" in route.headers || "Link" in route.headers),
);

const routes = [
  ...headerRoutes,
  ...(hasHomeLinkRoute ? [] : [{ src: "^/$", headers: { Link: homeLinkMerged }, continue: true }]),
  ...archivedIndexMdRedirects,
  agentModeRoute,
  ...syncedRoutes.slice(0, filesystemIndex),
  ...syncedRoutes.slice(filesystemIndex),
];

writeFileSync(configPath, `${JSON.stringify({ ...config, routes }, null, "\t")}\n`);

const addedCount = routes.length - syncedRoutes.length;

console.log(`[vercel] added ${addedCount} routes to .vercel/output/config.json`);
