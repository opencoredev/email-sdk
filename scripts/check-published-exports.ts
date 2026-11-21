/**
 * Fails when the docs or README show an `@opencoredev/email-sdk/<subpath>` import that the
 * published `latest` release does not export, unless that page says the subpath is unreleased.
 *
 * Docs deploy from `main`, but the package publishes only when the Version Packages PR merges,
 * so a page can document a subpath that `npm install` does not have yet (this happened with
 * `/inbound` in 3.0.1). Each page that imports an unpublished subpath must contain
 * UNRELEASED_MARKER. After the release ships, a leftover marker is reported as a warning.
 *
 * Needs the npm registry. When the registry is unreachable, the check prints NOT CHECKED and
 * exits 0, unless REQUIRE_REGISTRY=1.
 */
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { z } from "zod";

export const PACKAGE_NAME = "@opencoredev/email-sdk";

/** The sentence each page importing an unpublished subpath must contain. */
export const UNRELEASED_MARKER = "is not in a published release yet";

const repoRoot = new URL("..", import.meta.url).pathname;

const packageManifest = z.object({
  version: z.string(),
  exports: z.record(z.string(), z.unknown()),
});

export type DocFile = { path: string; content: string };

export type PublishedExportsReport = {
  unpublished: string[];
  /** Pages that import an unpublished subpath without the unreleased marker. */
  unmarked: { path: string; subpaths: string[] }[];
  /** Pages that keep the marker although every subpath they import is published. */
  staleMarkers: string[];
};

/** `./inbound` -> `@opencoredev/email-sdk/inbound`; the root export has no subpath. */
function specifierOf(subpath: string): string | undefined {
  return subpath === "." ? undefined : `${PACKAGE_NAME}/${subpath.slice(2)}`;
}

function importedSubpaths(content: string, subpaths: readonly string[]): string[] {
  return subpaths.filter((subpath) => {
    const specifier = specifierOf(subpath);

    // Match the specifier only when it ends there, so `/react` does not match `/react-email`.
    return (
      specifier !== undefined && new RegExp(`${escapeRegExp(specifier)}(?![\\w/-])`).test(content)
    );
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function checkPublishedExports(options: {
  localExports: readonly string[];
  publishedExports: readonly string[];
  files: readonly DocFile[];
}): PublishedExportsReport {
  const published = new Set(options.publishedExports);
  const unpublished = options.localExports.filter((subpath) => !published.has(subpath)).sort();
  const unmarked: PublishedExportsReport["unmarked"] = [];
  const staleMarkers: string[] = [];

  for (const file of options.files) {
    const missing = importedSubpaths(file.content, unpublished);
    const marked = file.content.includes(UNRELEASED_MARKER);

    if (missing.length > 0 && !marked) unmarked.push({ path: file.path, subpaths: missing });

    if (missing.length === 0 && marked) staleMarkers.push(file.path);
  }

  return { unpublished, unmarked, staleMarkers };
}

function docFiles(): DocFile[] {
  // Current docs only; content/docs-v holds released snapshots.
  const docsRoot = join(repoRoot, "apps/fumadocs/content/docs");

  const docs = [...new Bun.Glob("**/*.{md,mdx}").scanSync(docsRoot)].map((file) =>
    join(docsRoot, file),
  );

  const paths = [join(repoRoot, "packages/email-sdk/README.md"), ...docs].sort();

  return paths.map((path) => ({
    path: relative(repoRoot, path),
    content: readFileSync(path, "utf8"),
  }));
}

async function publishedManifest() {
  const response = await fetch(`https://registry.npmjs.org/${PACKAGE_NAME}/latest`, {
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) throw new Error(`npm registry answered ${response.status}.`);

  return packageManifest.parse(await response.json());
}

async function main() {
  const local = packageManifest.parse(
    JSON.parse(readFileSync(join(repoRoot, "packages/email-sdk/package.json"), "utf8")),
  );

  let published: z.infer<typeof packageManifest>;

  try {
    published = await publishedManifest();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (process.env.REQUIRE_REGISTRY === "1") {
      console.error(`Published export check failed: ${reason}`);
      process.exit(1);
    }

    console.log(
      `NOT CHECKED: published export check could not reach the npm registry (${reason}).`,
    );

    return;
  }

  const report = checkPublishedExports({
    localExports: Object.keys(local.exports),
    publishedExports: Object.keys(published.exports),
    files: docFiles(),
  });

  for (const path of report.staleMarkers) {
    console.warn(
      `warning: ${path} says a subpath "${UNRELEASED_MARKER}", but every subpath it imports is in ${PACKAGE_NAME}@${published.version}. Remove the note.`,
    );
  }

  if (report.unmarked.length > 0) {
    console.error(
      `These pages import subpaths that ${PACKAGE_NAME}@${published.version} (npm latest) does not export. Add a note containing "${UNRELEASED_MARKER}", or release first:`,
    );

    for (const { path, subpaths } of report.unmarked) {
      console.error(`- ${path}: ${subpaths.join(", ")}`);
    }

    process.exit(1);
  }

  const pending =
    report.unpublished.length > 0 ? ` Unreleased: ${report.unpublished.join(", ")}.` : "";

  console.log(
    `Published export check passed against ${PACKAGE_NAME}@${published.version}.${pending}`,
  );
}

if (import.meta.main) await main();
