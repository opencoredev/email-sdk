// Writes each current page's `lastModified` front matter from git history
// (lib/lastmod.ts): the newest commit that changed the page or the data its
// components render. Blume reads that date for the sitemap <lastmod>, the
// "Last updated" line, and the page's dateModified JSON-LD. Compare pair pages
// (dated from lib/compare.ts) and blog posts set their own dates and are left
// alone; archived versions keep their git dates. The homepage and /blog index
// have no front matter, so their dates go to lib/custom-page-dates.json, which
// the post-build sitemap patch reads. Runs before every build, so a deploy from a full clone
// (VERCEL_DEEP_CLONE=true) is current even when nobody ran it locally.
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { customPageDatesPath, fileLastmod, hasFullHistory, homePageSources, pageLastmod, repoRoot } from "../lib/lastmod";

const contentDir = join(import.meta.dirname, "../content");

const pageDirs = ["docs", "(project)", "tools"];

if (!hasFullHistory()) {
  console.warn("[lastmod] no full git history (shallow clone or no .git), so the committed dates stay.");
  process.exit(0);
}

const today = new Date().toISOString().slice(0, 10);

const pages = [
  ...pageDirs.flatMap((dir) =>
    readdirSync(join(contentDir, dir), { recursive: true, encoding: "utf8" })
      .filter((file) => file.endsWith(".mdx"))
      .map((file) => join(contentDir, dir, file)),
  ),
  join(contentDir, "compare/index.mdx"),
];

let updated = 0;

for (const page of pages.toSorted()) {
  const source = readFileSync(page, "utf8");
  const date = pageLastmod(relative(repoRoot, page), source, today);
  const frontmatterEnd = source.indexOf("\n---\n", 4);

  if (date === undefined || !source.startsWith("---\n") || frontmatterEnd === -1) continue;

  const frontmatter = source
    .slice(4, frontmatterEnd)
    .split("\n")
    .filter((line) => !line.startsWith("lastModified: "));

  const next = `---\n${[...frontmatter, `lastModified: ${date}`].join("\n")}${source.slice(frontmatterEnd)}`;

  if (next === source) continue;

  writeFileSync(page, next);
  updated += 1;
}

const customPageDates = {
  home: homePageSources
    .flatMap((file) => fileLastmod(file, today) ?? [])
    .toSorted()
    .at(-1),
  blogIndex: fileLastmod("apps/docs/pages/blog/index.astro", today),
};

writeFileSync(customPageDatesPath, `${JSON.stringify(customPageDates, null, 2)}\n`);

console.log(`[lastmod] dated ${pages.length} pages, updated ${updated}`);
