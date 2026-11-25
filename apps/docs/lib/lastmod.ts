// Each page's published modification date: the newest commit that changed the
// page's own source or a data file it renders, read from git history. Used by
// scripts/generate-lastmod.ts (page front matter) and
// scripts/patch-vercel-config.ts (the custom pages' sitemap dates).
import { spawnSync } from "node:child_process";
import { join } from "node:path";

export const repoRoot = join(import.meta.dirname, "../../..");

// #350 moved the site from apps/fumadocs to apps/docs. Its edits to existing
// pages converted Fumadocs syntax to Blume's, so it never counts as a content
// change, and history before it is read from each file's Fumadocs path.
export const blumeMigrationCommit = "559f8e357ead31b0076ba74a4cbb86e9ce498642";

// Pages the migration created from a Fumadocs route component, which mixed
// page code with content, so their git history overstates content changes.
// These are the dates the Fumadocs sitemap kept for them by hand.
const fumadocsSitemapDates = new Map<string, string>([
  ["apps/docs/content/(project)/about.mdx", "2026-09-26"],
  ["apps/docs/content/(project)/contact.mdx", "2026-09-07"],
  ["apps/docs/content/(project)/privacy.mdx", "2026-09-07"],
  ["apps/docs/content/(project)/stats.mdx", "2026-09-07"],
  ["apps/docs/content/(project)/terms.mdx", "2026-09-07"],
  ["apps/docs/content/tools/index.mdx", "2026-09-24"],
  ["apps/docs/content/tools/email-dns-checker.mdx", "2026-09-24"],
  ["apps/docs/pages/index.astro", "2026-11-22"],
]);

// The data each MDX component renders, as repo-relative paths. A page that uses
// the component changes whenever one of these files does.
const componentData = new Map<string, readonly string[]>([
  ["AdapterCapabilitySupport", ["apps/docs/lib/adapter-support.ts"]],
  ["AdapterFieldSupport", ["apps/docs/lib/adapter-support.ts"]],
  [
    "AdapterVerification",
    [
      "apps/docs/lib/adapter-verification.ts",
      "adapter-verification.json",
      "adapter-verification-evidence.json",
    ],
  ],
  ["AdapterPricing", ["apps/docs/lib/adapter-pricing.ts"]],
  [
    "CommunityPluginRegistry",
    ["apps/docs/lib/community-registry.ts", "apps/docs/content/community/plugins.json"],
  ],
  ["EmailExampleGallery", ["apps/docs/lib/email-example-data.ts"]],
  ["ProviderGrid", ["apps/docs/lib/providers.ts"]],
  ["SponsorSpotlight", ["apps/docs/lib/sponsors.ts"]],
]);

// The landing page is an Astro page, so its data files are listed by hand.
export const homePageSources = [
  "apps/docs/pages/index.astro",
  "apps/docs/lib/opencore-sites.ts",
  "apps/docs/lib/sponsors.ts",
];

/** Where a repo-relative file lived before the Blume migration, if it moved. */
export function fumadocsPath(path: string): string | undefined {
  if (path.startsWith("apps/docs/content/docs/")) {
    return path.replace("apps/docs/content/docs/", "apps/fumadocs/content/docs/");
  }

  if (path.startsWith("apps/docs/lib/")) return path.replace("apps/docs/lib/", "apps/fumadocs/src/lib/");

  return undefined;
}

/** The data files the components in an MDX page render. */
export function pageDataFiles(source: string): string[] {
  const files = [...componentData]
    .filter(([component]) => source.includes(`<${component}`))
    .flatMap(([, data]) => data);

  return [...new Set(files)];
}

/**
 * Whether a `-U0` patch changes anything besides a `lastModified:` front matter
 * line, so commits that only refresh the date don't date the page.
 */
export function changesContent(patch: string): boolean {
  return patch
    .split("\n")
    .filter((line) => /^[+-]/.test(line) && !/^(\+\+\+|---) /.test(line))
    .some((line) => !/^[+-]lastModified: /.test(line));
}

function git(args: readonly string[]): string {
  const result = spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);

  return result.stdout;
}

export function isShallowClone(): boolean {
  return git(["rev-parse", "--is-shallow-repository"]).trim() === "true";
}

/**
 * The date (YYYY-MM-DD) a repo-relative file's content last changed: today when
 * the working tree changes it, else its newest commit that changed more than
 * the `lastModified:` line, skipping the Blume migration and following the file
 * back to its Fumadocs path. A page the migration created from a route
 * component falls back to its Fumadocs sitemap date.
 */
export function fileLastmod(path: string, today: string): string | undefined {
  if (git(["status", "--porcelain", "--", path]).startsWith("??")) return today;

  if (changesContent(git(["diff", "HEAD", "-U0", "--", path]))) return today;

  const fumadocs = fumadocsPath(path);
  const paths = fumadocs ? [path, fumadocs] : [path];
  const log = git(["log", "--format=%x00%H %cs", "-p", "-U0", "--no-renames", "--", ...paths]);

  for (const entry of log.split("\0").slice(1)) {
    const [hash = "", date = ""] = entry.slice(0, entry.indexOf("\n")).split(" ");

    if (hash !== blumeMigrationCommit && changesContent(entry)) return date;
  }

  return fumadocsSitemapDates.get(path);
}

/** The newest content date across a page's source and the data it renders. */
export function pageLastmod(path: string, source: string, today: string): string | undefined {
  return [path, ...pageDataFiles(source)]
    .flatMap((file) => fileLastmod(file, today) ?? [])
    .toSorted()
    .at(-1);
}
