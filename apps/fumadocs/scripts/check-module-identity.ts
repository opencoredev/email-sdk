// 2026-07-07: The docs app and fumadocs-ui must resolve singleton-critical
// packages to the SAME physical install. lucide-react is a peer dependency of
// fumadocs-core, so if the app's lucide-react version diverges from the one
// fumadocs-ui resolves (as happened when a deps-refresh bumped the app to
// lucide-react 1.23.0 while the lockfile kept fumadocs-ui's edge on 1.16.0),
// bun's isolated linker materializes fumadocs-core once per peer set. Two
// fumadocs-core instances mean two React context instances: RootProvider
// provides on one, components consume the other, and every page dies at
// hydration with "You need to wrap your application inside
// `FrameworkProvider`". The build stays green, so this must be checked
// explicitly. Runs before `vite build`; exits non-zero on any split.
import { realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const appDir = resolve(import.meta.dirname, "..");

// Packages that hold React contexts or other module-level singletons shared
// between the app and fumadocs-ui. A second instance of any of these breaks
// hydration or context lookups at runtime.
const SINGLETONS = ["fumadocs-core", "react", "react-dom", "@tanstack/react-router"];

function resolveFrom(baseDir: string, pkg: string): string {
  const req = createRequire(resolve(baseDir, "noop.js"));
  return realpathSync(dirname(req.resolve(`${pkg}/package.json`)));
}

const fumadocsUiDir = resolveFrom(appDir, "fumadocs-ui");

let failed = false;

for (const pkg of SINGLETONS) {
  const fromApp = resolveFrom(appDir, pkg);
  let fromUi: string;
  try {
    fromUi = resolveFrom(fumadocsUiDir, pkg);
  } catch {
    // fumadocs-ui doesn't depend on it (directly or via peers) — nothing to split.
    continue;
  }

  if (fromApp !== fromUi) {
    failed = true;
    console.error(`[check-module-identity] "${pkg}" resolves to two different installs:`);
    console.error(`  app         -> ${fromApp}`);
    console.error(`  fumadocs-ui -> ${fromUi}`);
  }
}

// The usual trigger for a fumadocs-core split is lucide-react diverging
// (it is a peer of fumadocs-core), so name it explicitly when it happens.
try {
  const lucideApp = resolveFrom(appDir, "lucide-react");
  const lucideUi = resolveFrom(fumadocsUiDir, "lucide-react");
  if (lucideApp !== lucideUi) {
    failed = true;
    console.error(
      "[check-module-identity] lucide-react diverged between the app and fumadocs-ui — keep the app's lucide-react range resolving to the same version fumadocs-ui uses (it is a peer dependency of fumadocs-core and splits it when versions differ):",
    );
    console.error(`  app         -> ${lucideApp}`);
    console.error(`  fumadocs-ui -> ${lucideUi}`);
  }
} catch {
  // lucide-react missing on one side is fine.
}

if (failed) {
  console.error(
    "[check-module-identity] duplicated singleton installs crash every page at hydration (FrameworkProvider error). Align the versions in apps/fumadocs/package.json with what fumadocs-ui resolves, or run a full re-resolve so bun unifies them.",
  );
  process.exit(1);
}

console.log(
  `[check-module-identity] ok: ${SINGLETONS.join(", ")} and lucide-react each resolve to a single install`,
);
