// Splices the site's security headers and the /?mode=agent rewrite
// (lib/vercel-headers.ts) into the Build Output API config `blume build`
// writes for Vercel. Runs after the build; a second run changes nothing.
// The route logic lives in lib/vercel-config-patch.ts, which has tests.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import {
  patchVercelRoutes,
  trimArchivedLlms,
  vercelConfigSchema,
} from "../lib/vercel-config-patch";
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

const config = vercelConfigSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));

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

  const trimmed = trimArchivedLlms(
    llms,
    archivedDocsVersions.map((version) => version.id),
  );

  if (trimmed !== llms) writeFileSync(builtLlmsTxtPath, trimmed);
}

let patch: ReturnType<typeof patchVercelRoutes>;

try {
  patch = patchVercelRoutes({ routes: config.routes, indexTokenCount });
} catch (error) {
  console.error(`[vercel] ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

if (patch.kind === "unchanged") {
  console.log("[vercel] config.json already carries the site routes");
  process.exit(0);
}

writeFileSync(configPath, `${JSON.stringify({ ...config, routes: patch.routes }, null, "\t")}\n`);

console.log(`[vercel] added ${patch.added} routes to .vercel/output/config.json`);
