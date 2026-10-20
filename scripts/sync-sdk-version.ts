// Writes packages/email-sdk/package.json's version into src/version.ts, so the
// version telemetry reports survives bundling. Runs after `changeset version`.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

const packageDir = resolve(import.meta.dir, "../packages/email-sdk");

const packageJson = z
  .object({ version: z.string().min(1) })
  .parse(JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8")));

const versionFile = resolve(packageDir, "src/version.ts");

const declaration = /export const SDK_VERSION = "[^"]*";/;

const current = await readFile(versionFile, "utf8");

if (!declaration.test(current)) {
  throw new Error(`Could not find the SDK_VERSION declaration in ${versionFile}.`);
}

await writeFile(
  versionFile,
  current.replace(
    declaration,
    `export const SDK_VERSION = ${JSON.stringify(packageJson.version)};`,
  ),
);

console.log(`SDK_VERSION = ${packageJson.version}`);
