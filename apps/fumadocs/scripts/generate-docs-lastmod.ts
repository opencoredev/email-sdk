/**
 * Regenerates src/lib/docs-lastmod.generated.json with the last git commit date
 * (YYYY-MM-DD) of every current-version docs page, keyed by path relative to
 * content/docs. The manifest is committed because Vercel builds from a shallow
 * clone where per-file git history is unavailable.
 *
 * Run with: bun run lastmod:generate (from apps/fumadocs) — do this whenever
 * docs content changes, ideally as part of the release flow.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const appDir = resolve(import.meta.dir, "..");
const docsDir = join(appDir, "content/docs");
const outputPath = join(appDir, "src/lib/docs-lastmod.generated.json");

function listMdxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) return listMdxFiles(fullPath);
    return entry.name.endsWith(".mdx") ? [fullPath] : [];
  });
}

function gitLastCommitDate(filePath: string): string | undefined {
  const result = spawnSync("git", ["log", "-1", "--format=%cs", "--", filePath], {
    cwd: appDir,
    encoding: "utf8",
  });
  const date = result.stdout.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : undefined;
}

const shallowCheck = spawnSync("git", ["rev-parse", "--is-shallow-repository"], {
  cwd: appDir,
  encoding: "utf8",
});
if (shallowCheck.stdout.trim() === "true") {
  console.error("Repository is a shallow clone; git dates would be wrong. Aborting.");
  process.exit(1);
}

const today = new Date().toISOString().slice(0, 10);
const manifest: Record<string, string> = {};
for (const file of listMdxFiles(docsDir).sort()) {
  // Uncommitted pages fall back to today so new docs still get a real date.
  manifest[relative(docsDir, file)] = gitLastCommitDate(file) ?? today;
}

writeFileSync(outputPath, `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`Wrote ${Object.keys(manifest).length} entries to ${relative(appDir, outputPath)}`);
