#!/usr/bin/env bun
// Guards the anti-slop lint gate. Fails when a rule is missing or weakened,
// when a file opts out through a disable directive, when a nested config or
// override could silently turn rules off, or when the vendored plugin source
// changes without its checksums being deliberately refreshed.
//
//   bun scripts/check-lint-policy.ts                     # verify
//   bun scripts/check-lint-policy.ts --update-checksums  # after a reviewed plugin update

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { z } from "zod";

const root = join(import.meta.dir, "..");

const pluginDir = "tools/oxlint/anti-slop";

const pluginSpecifier = `./${pluginDir}/index.ts`;

const checksumPath = join(root, pluginDir, "checksums.json");

// Every ignore pattern must be listed here. Ignoring source to dodge
// findings is not allowed; only third-party, generated, and agent-tool paths.
const allowedIgnorePatterns = new Set([
  "apps/fumadocs/src/components/dither-kit/**",
  "apps/fumadocs/src/routeTree.gen.ts",
  "**/_generated/**",
  ".agent/**",
  ".agents/**",
  ".claude/**",
  ".codex/**",
  ".continue/**",
  ".cursor/**",
  ".gemini/**",
  ".opencode/**",
  ".pi/**",
  ".roo/**",
  ".windsurf/**",
  `${pluginDir}/**`,
]);

// Generated files that ship their own disable banner and are lint-ignored.
const allowedDirectiveFiles = new Set(["apps/fumadocs/src/routeTree.gen.ts"]);

const requiredNativeRules = ["oxc/no-accumulating-spread"];

const configSchema = z.object({
  ignorePatterns: z.array(z.string()).default([]),
  jsPlugins: z.array(z.object({ name: z.string(), specifier: z.string() })).default([]),
  rules: z.record(z.string(), z.union([z.string(), z.array(z.json())])).default({}),
  overrides: z.array(z.json()).optional(),
});

const checksumSchema = z.record(z.string(), z.string());

const failures: string[] = [];

function git(...args: string[]): string[] {
  const result = Bun.spawnSync(["git", ...args], { cwd: root });

  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr.toString()}`);
  }

  return result.stdout.toString().split("\n").filter(Boolean);
}

function sha256(path: string): string {
  return createHash("sha256")
    .update(readFileSync(join(root, path)))
    .digest("hex");
}

function pluginChecksums(): Record<string, string> {
  const files = git("ls-files", "--cached", "--others", "--exclude-standard", pluginDir)
    .filter((file) => file !== relative(root, checksumPath))
    .toSorted();

  return Object.fromEntries(files.map((file) => [file, sha256(file)]));
}

async function pluginRuleNames(): Promise<string[]> {
  const pluginModule = await import(join(root, pluginDir, "index.ts"));
  const plugin = z.object({ rules: z.record(z.string(), z.unknown()) }).parse(pluginModule.default);

  return Object.keys(plugin.rules).map((name) => `anti-slop/${name}`);
}

if (process.argv.includes("--update-checksums")) {
  writeFileSync(checksumPath, `${JSON.stringify(pluginChecksums(), null, 2)}\n`);
  console.log(`Updated ${relative(root, checksumPath)}`);
  process.exit(0);
}

const config = configSchema.parse(JSON.parse(readFileSync(join(root, ".oxlintrc.json"), "utf8")));

const registered = config.jsPlugins.some(
  (plugin) => plugin.name === "anti-slop" && plugin.specifier === pluginSpecifier,
);

if (!registered) {
  failures.push(
    `.oxlintrc.json must register jsPlugins { name: "anti-slop", specifier: "${pluginSpecifier}" }`,
  );
}

for (const rule of [...requiredNativeRules, ...(await pluginRuleNames())]) {
  const setting = config.rules[rule];
  const severity = Array.isArray(setting) ? setting[0] : setting;

  if (severity !== "error") {
    failures.push(
      `.oxlintrc.json must set "${rule}" to "error" (found ${JSON.stringify(setting)})`,
    );
  }
}

if (config.overrides !== undefined) {
  failures.push(
    ".oxlintrc.json must not define overrides; they can switch anti-slop rules off per path",
  );
}

for (const pattern of config.ignorePatterns) {
  if (!allowedIgnorePatterns.has(pattern)) {
    failures.push(`.oxlintrc.json ignorePatterns contains unapproved pattern "${pattern}"`);
  }
}

const trackedFiles = git("ls-files", "--cached", "--others", "--exclude-standard");

for (const file of trackedFiles) {
  const name = file.split("/").at(-1) ?? file;

  if (
    file !== ".oxlintrc.json" &&
    /^(\.oxlintrc(\.json)?|oxlint\.config\.[cm]?[jt]s)$/.test(name)
  ) {
    failures.push(
      `${file}: nested oxlint configs are not allowed; keep all lint config in .oxlintrc.json`,
    );
  }
}

const sourceFiles = trackedFiles.filter(
  (file) =>
    /\.(?:[cm]?[jt]sx?|vue|svelte|astro)$/.test(file) &&
    !file.startsWith(`${pluginDir}/`) &&
    !allowedDirectiveFiles.has(file),
);

const directivePattern = /(?:oxlint|eslint)-(?:disable|enable)|@ts-(?:ignore|nocheck)/;

for (const file of sourceFiles) {
  let text: string;

  try {
    text = readFileSync(join(root, file), "utf8");
  } catch {
    continue;
  }

  // Tracks multiline block comments so a directive on a line of its own inside one is still caught.
  let inBlockComment = false;

  for (const [index, line] of text.split("\n").entries()) {
    if (directivePattern.test(line) && (inBlockComment || /\/\/|\/\*/.test(line))) {
      failures.push(
        `${file}:${index + 1}: lint/type disable directives are not allowed; fix the code instead`,
      );
    }

    const opened = line.lastIndexOf("/*");
    const closed = line.lastIndexOf("*/");

    if (opened > closed) inBlockComment = true;
    else if (closed !== -1) inBlockComment = false;
  }
}

let expectedChecksums: Record<string, string> = {};

try {
  expectedChecksums = checksumSchema.parse(JSON.parse(readFileSync(checksumPath, "utf8")));
} catch {
  failures.push(`${relative(root, checksumPath)} is missing or invalid`);
}

const actualChecksums = pluginChecksums();

for (const file of new Set([...Object.keys(expectedChecksums), ...Object.keys(actualChecksums)])) {
  if (expectedChecksums[file] !== actualChecksums[file]) {
    failures.push(
      `${file}: vendored anti-slop source changed. Review the change, record it in ${pluginDir}/UPSTREAM.md, then run bun scripts/check-lint-policy.ts --update-checksums`,
    );
  }
}

if (failures.length > 0) {
  console.error(
    `Lint policy check failed:\n${failures.map((failure) => `  - ${failure}`).join("\n")}`,
  );
  process.exit(1);
}

console.log(
  "Lint policy check passed: anti-slop is registered, every rule is at error, and nothing opts out.",
);
