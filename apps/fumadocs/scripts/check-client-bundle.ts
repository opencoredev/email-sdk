// 2026-07-07: Backstop after `vite build`: the client bundle must contain at
// most one copy of fumadocs-core's framework context module. Two copies mean
// two React context instances — RootProvider writes to one while components
// read the other, crashing every page at hydration with "You need to wrap
// your application inside `FrameworkProvider`". The usual root cause is two
// physical fumadocs-core installs (see check-module-identity.ts, which runs
// before the build and catches that directly); this check additionally
// guards against the bundler itself splitting the module graph. Note it can
// miss an install-level split when the bundler merges identical module
// content, so it complements — not replaces — the identity check.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// The context module carries this unique error string; at most one client
// chunk may contain it. Two or more means two context instances at runtime.
// Note: byte-identical *leaf* chunks are normal here (archived docs versions
// compile the same MDX pages N times, and the lazy search graph duplicates
// tiny helpers) — only duplication of the context module is fatal, so that
// is the only thing this guard fails on.
const CONTEXT_MARKER = "FrameworkProvider";

const candidateDirs = [
  // Vercel Build Output (nitro vercel preset writes to the repo root)
  resolve(import.meta.dirname, "../../../.vercel/output/static/assets"),
  resolve(import.meta.dirname, "../.vercel/output/static/assets"),
  // Local nitro output
  resolve(import.meta.dirname, "../.output/public/assets"),
];

// Optional explicit dir (used by tests / ad-hoc runs): bun scripts/check-client-bundle.ts <assetsDir>
// Otherwise prefer the most recently written candidate so a stale local
// .vercel/output never shadows a fresh .output build (or vice versa).
const assetsDir = process.argv[2]
  ? resolve(process.argv[2])
  : candidateDirs
      .filter((dir) => existsSync(dir))
      .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];

if (!assetsDir) {
  console.error("[check-client-bundle] no client assets directory found; looked in:");
  for (const dir of candidateDirs) console.error(`  - ${dir}`);
  process.exit(1);
}

const jsFiles = readdirSync(assetsDir).filter((file) => file.endsWith(".js"));

const markerChunks = jsFiles.filter((file) =>
  readFileSync(join(assetsDir, file)).includes(CONTEXT_MARKER),
);

if (markerChunks.length > 1) {
  console.error(
    `[check-client-bundle] fumadocs framework context ("${CONTEXT_MARKER}") is bundled into ${markerChunks.length} client chunks — RootProvider and consumers would use different context instances and every page would crash at hydration:`,
  );
  for (const file of markerChunks) console.error(`  - ${file}`);
  console.error(
    "[check-client-bundle] the module graph is duplicated. Check for two physical fumadocs-core installs first (scripts/check-module-identity.ts), then for a bundler chunking regression.",
  );
  process.exit(1);
}

console.log(
  `[check-client-bundle] ok: framework context in ${markerChunks.length === 1 ? "exactly one" : "no"} of ${jsFiles.length} client chunks in ${assetsDir}`,
);
