// Each page's published modification date: the newest commit that changed the
// page's own source or a data file it renders, read from git history. Used by
// scripts/generate-lastmod.ts (page front matter) and
// scripts/patch-vercel-config.ts (the custom pages' sitemap dates).
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
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
  ["apps/docs/content/compare/index.mdx", "2026-11-23"],
  ["apps/docs/pages/index.astro", "2026-11-22"],
]);

// The data each MDX component renders, as repo-relative paths, following the
// component's imports. A page that uses the component changes whenever one of
// these files does.
const providerCatalogData = [
  "apps/docs/lib/providers.ts",
  "apps/docs/lib/sponsors.ts",
  "adapter-verification.json",
];

const componentData = new Map<string, readonly string[]>([
  ["AdapterCapabilitySupport", ["apps/docs/lib/adapter-support.ts"]],
  ["AdapterFieldSupport", ["apps/docs/lib/adapter-support.ts"]],
  [
    "AdapterVerification",
    [
      "apps/docs/lib/adapter-verification.ts",
      "apps/docs/lib/adapter-support.ts",
      "adapter-verification.json",
      "adapter-verification-evidence.json",
    ],
  ],
  ["AdapterPricing", ["apps/docs/lib/adapter-pricing.ts", ...providerCatalogData]],
  [
    "CommunityPluginRegistry",
    ["apps/docs/lib/community-registry.ts", "apps/docs/content/community/plugins.json"],
  ],
  ["EmailExample", ["apps/docs/lib/email-example-data.ts"]],
  ["EmailExampleGallery", ["apps/docs/lib/email-example-data.ts"]],
  ["ProviderBadge", providerCatalogData],
  ["ProviderGrid", providerCatalogData],
  ["SponsorSpotlight", ["apps/docs/lib/sponsors.ts"]],
]);

// The last date each adapter's FAQ answers changed before the migration. The
// Fumadocs site rendered them from lib/adapter-faq.ts at request time; since
// the migration they are generated into each adapter page, so later changes
// show up in that page's own history. Computed once by evaluating
// buildAdapterFaq at every pre-migration commit to its inputs.
const fumadocsFaqDates = new Map<string, string>([
  ["resend", "2026-09-07"],
  ["postmark", "2026-11-23"],
  ["sendgrid", "2026-11-23"],
  ["cloudflare", "2026-11-23"],
  ["unosend", "2026-11-23"],
  ["ses", "2026-11-23"],
  ["mailgun", "2026-11-23"],
  ["mailersend", "2026-11-23"],
  ["brevo", "2026-11-23"],
  ["mailchimp", "2026-11-23"],
  ["sparkpost", "2026-11-23"],
  ["iterable", "2026-11-23"],
  ["loops", "2026-11-23"],
  ["sequenzy", "2026-11-23"],
  ["jetemail", "2026-09-07"],
  ["lettermint", "2026-09-07"],
  ["lettr", "2026-11-23"],
  ["primitive", "2026-09-07"],
  ["plunk", "2026-11-23"],
  ["mailtrap", "2026-11-23"],
  ["scaleway", "2026-11-23"],
  ["zeptomail", "2026-11-23"],
  ["mailpace", "2026-11-23"],
  ["smtp", "2026-09-16"],
  ["graph", "2026-11-23"],
  ["sendheron", "2026-09-24"],
  ["helo", "2026-09-26"],
]);

// The landing page is an Astro page, so its data files are listed by hand.
/** Committed dates for the pages without front matter: the homepage and /blog. */
export const customPageDatesPath = join(repoRoot, "apps/docs/lib/custom-page-dates.json");

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

  if (path.startsWith("apps/docs/content/community/")) {
    return path.replace("apps/docs/content/community/", "apps/fumadocs/content/community/");
  }

  if (path.startsWith("apps/docs/lib/")) return path.replace("apps/docs/lib/", "apps/fumadocs/src/lib/");

  return undefined;
}

/** The data files the components in an MDX page render. */
export function pageDataFiles(source: string): string[] {
  const files = [...componentData]
    .filter(([component]) => new RegExp(`<${component}[\\s/>]`).test(source))
    .flatMap(([, data]) => data);

  return [...new Set(files)];
}

/**
 * A file's text without its front matter `lastModified:` line, so a commit
 * that only refreshes the date doesn't date the page. Line endings are
 * normalized, so a CRLF checkout of an unchanged file matches its blob.
 */
export function withoutLastmod(checkout: string): string {
  const text = checkout.replaceAll("\r\n", "\n");
  const end = text.startsWith("---\n") ? text.indexOf("\n---\n", 3) : -1;

  if (end === -1) return text;

  const frontmatter = text
    .slice(0, end)
    .split("\n")
    .filter((line) => !line.startsWith("lastModified: "));

  return `${frontmatter.join("\n")}${text.slice(end)}`;
}

function git(args: readonly string[]) {
  return spawnSync("git", ["-C", repoRoot, ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

function gitOutput(args: readonly string[]): string {
  const result = git(args);

  if (result.status !== 0) throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);

  return result.stdout;
}

/** A file's text at a revision, or "" where it didn't exist. */
function textAt(revision: string, path: string): string {
  const result = git(["show", `${revision}:${path}`]);

  return result.status === 0 ? result.stdout : "";
}

/**
 * Whether full git history is readable here. False outside a repository (a
 * source upload without .git) and in a shallow clone, where dates would be
 * wrong, so callers keep the committed dates instead.
 */
export function hasFullHistory(): boolean {
  const result = git(["rev-parse", "--is-shallow-repository"]);

  return result.status === 0 && result.stdout.trim() === "false";
}

/**
 * The date (YYYY-MM-DD) a repo-relative file's content last changed: today when
 * the working tree changes it, else its newest commit that changed more than
 * the `lastModified:` line, skipping the Blume migration and following the file
 * back to its Fumadocs path. A page the migration created from a route
 * component falls back to its Fumadocs sitemap date.
 */
export function fileLastmod(path: string, today: string): string | undefined {
  const working = existsSync(join(repoRoot, path)) ? readFileSync(join(repoRoot, path), "utf8") : "";

  if (withoutLastmod(working) !== withoutLastmod(textAt("HEAD", path))) return today;

  const fumadocs = fumadocsPath(path);
  const paths = fumadocs ? [path, fumadocs] : [path];
  const log = gitOutput(["log", "--format=%x00%H %cs", "--name-only", "--no-renames", "--", ...paths]);

  for (const entry of log.split("\0").slice(1)) {
    const [header = "", ...names] = entry.trim().split("\n");
    const [hash = "", date = ""] = header.split(" ");

    if (hash === blumeMigrationCommit) continue;

    const changed = names
      .filter((name) => paths.includes(name))
      .some((name) => withoutLastmod(textAt(hash, name)) !== withoutLastmod(textAt(`${hash}^`, name)));

    if (changed) return date;
  }

  return fumadocsSitemapDates.get(path);
}

/** The newest content date across a page's source and the data it renders. */
export function pageLastmod(path: string, source: string, today: string): string | undefined {
  const adapter = /^apps\/docs\/content\/docs\/adapters\/([^/]+)\.mdx$/.exec(path)?.[1];

  return [path, ...pageDataFiles(source)]
    .flatMap((file) => fileLastmod(file, today) ?? [])
    .concat(adapter ? (fumadocsFaqDates.get(adapter) ?? []) : [])
    .toSorted()
    .at(-1);
}
