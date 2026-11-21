// Splices the site's security headers and the /?mode=agent rewrite
// (lib/vercel-headers.ts) into the Build Output API config `blume build`
// writes for Vercel. Runs after the build; a second run changes nothing.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { z } from "zod";

import { agentModeRoute, headerRoutes } from "../lib/vercel-headers";

const configPath = join(import.meta.dirname, "../.vercel/output/config.json");

if (!existsSync(configPath)) {
  console.error(`[vercel] ${configPath} is missing. Run \`blume build\` first.`);
  process.exit(1);
}

const configSchema = z.looseObject({ routes: z.array(z.looseObject({})) });

const config = configSchema.parse(JSON.parse(readFileSync(configPath, "utf8")));

// Blume sets no Content-Security-Policy itself, so finding one means this
// script already ran on this build.
const alreadyPatched = config.routes.some((route) =>
  JSON.stringify(route).includes("Content-Security-Policy"),
);

if (alreadyPatched) {
  console.log("[vercel] config.json already carries the site routes");
  process.exit(0);
}

const filesystemIndex = config.routes.findIndex((route) => route.handle === "filesystem");

if (filesystemIndex === -1) {
  console.error("[vercel] config.json has no filesystem handler; the routes can't be placed.");
  process.exit(1);
}

const routes = [
  ...headerRoutes,
  agentModeRoute,
  ...config.routes.slice(0, filesystemIndex),
  ...config.routes.slice(filesystemIndex),
];

writeFileSync(configPath, `${JSON.stringify({ ...config, routes }, null, "\t")}\n`);

console.log(`[vercel] added ${headerRoutes.length + 1} routes to .vercel/output/config.json`);
