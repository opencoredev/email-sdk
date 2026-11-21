// Splices the site's security headers and the /?mode=agent rewrite
// (lib/vercel-headers.ts) into the Build Output API config `blume build`
// writes for Vercel. Runs after the build; a second run changes nothing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { siteUrl } from "../lib/shared";
import { agentModeRoute, headerRoutes } from "../lib/vercel-headers";
import { archivedDocsVersions } from "../lib/versions";

const docsDir = join(import.meta.dirname, "..");

const configPath = join(docsDir, ".vercel/output/config.json");

const staticDir = join(docsDir, ".vercel/output/static");

const curatedIndexMdPath = join(docsDir, "public/index.md");

const builtIndexMdPath = join(staticDir, "index.md");

const builtLlmsTxtPath = join(staticDir, "llms.txt");

if (!existsSync(configPath)) {
  console.error(`[vercel] ${configPath} is missing. Run \`blume build\` first.`);
  process.exit(1);
}

const configSchema = z.looseObject({
  routes: z.array(
    z.looseObject({
      dest: z.string().optional(),
      handle: z.string().optional(),
      headers: z.record(z.string(), z.string()).optional(),
    }),
  ),
});

const config = configSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));

// Keep /index.md at the curated ~2 KB homepage summary and sync x-markdown-tokens.
const curatedIndexMd = existsSync(curatedIndexMdPath)
  ? readFileSync(curatedIndexMdPath, "utf8")
  : undefined;

if (curatedIndexMd !== undefined) {
  writeFileSync(builtIndexMdPath, curatedIndexMd);
}

const indexTokenCount =
  curatedIndexMd !== undefined ? String(Math.ceil(Buffer.byteLength(curatedIndexMd) / 4)) : undefined;

// Trim archived version link sections from llms.txt so the index stays focused on current docs.
if (existsSync(builtLlmsTxtPath)) {
  const llms = readFileSync(builtLlmsTxtPath, "utf8");
  const archivedHeadingIndex = llms.search(/^## v\d+\.\d+\.\d+ \(archived\)$/m);

  if (archivedHeadingIndex !== -1) {
    const summaryLines = archivedDocsVersions.map(
      (version) => `- [${version.id}](${siteUrl}/${version.id}/docs): archived documentation`,
    );

    const trimmed = [
      llms.slice(0, archivedHeadingIndex).trimEnd(),
      "",
      "## Archived versions",
      "",
      ...summaryLines,
      "",
    ].join("\n");

    writeFileSync(builtLlmsTxtPath, trimmed);
  }
}

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

  return route;
});

// Blume sets no Content-Security-Policy itself, so finding one means this
// script already ran on this build.
const alreadyPatched = syncedRoutes.some((route) =>
  JSON.stringify(route).includes("Content-Security-Policy"),
);

if (alreadyPatched) {
  writeFileSync(configPath, `${JSON.stringify({ ...config, routes: syncedRoutes }, null, "\t")}\n`);
  console.log("[vercel] config.json already carries the site routes");
  process.exit(0);
}

const filesystemIndex = syncedRoutes.findIndex((route) => route.handle === "filesystem");

if (filesystemIndex === -1) {
  console.error("[vercel] config.json has no filesystem handler; the routes can't be placed.");
  process.exit(1);
}

const routes = [
  ...headerRoutes,
  agentModeRoute,
  ...syncedRoutes.slice(0, filesystemIndex),
  ...syncedRoutes.slice(filesystemIndex),
];

writeFileSync(configPath, `${JSON.stringify({ ...config, routes }, null, "\t")}\n`);

console.log(`[vercel] added ${headerRoutes.length + 1} routes to .vercel/output/config.json`);
