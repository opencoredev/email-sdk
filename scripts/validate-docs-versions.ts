import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  archivedDocsVersions,
  archivedVersionContentPath,
  currentDocsMajorVersion,
  getCurrentDocsPublishedVersion,
  latestPublishedVersion as packageJsonVersion,
} from "../apps/docs/lib/versions";

// Checks the archived docs versions in apps/docs/lib/versions.ts against the
// Blume site: each one needs a content/<id>/docs snapshot, which blume.config.ts
// registers as an archived version and redirects to from its old
// /docs/v/<release> URL. Every released package version except the latest
// needs an archive.

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));

const docsRoot = join(repoRoot, "apps/docs");

const errors: string[] = [];

function fail(message: string) {
  errors.push(message);
}

const blumeConfig = readFileSync(join(docsRoot, "blume.config.ts"), "utf8");

const changelog = readFileSync(join(repoRoot, "packages/email-sdk/CHANGELOG.md"), "utf8");

const latestPublishedVersion =
  process.env.EMAIL_SDK_VALIDATE_DOCS_PACKAGE_VERSION ?? packageJsonVersion;

const currentDocsVersion = `v${currentDocsMajorVersion}`;

if (!/^\d+\.\d+\.\d+$/.test(latestPublishedVersion)) {
  fail(
    `Package version must be an exact SemVer release, got ${latestPublishedVersion}.` +
      " Set EMAIL_SDK_VALIDATE_DOCS_PACKAGE_VERSION only to simulate a future package.json version.",
  );
}

const publishedMajor = Number(latestPublishedVersion.split(".", 1)[0]);

const currentDocsPublishedVersion = getCurrentDocsPublishedVersion(latestPublishedVersion);

if (publishedMajor > currentDocsMajorVersion) {
  fail(
    `packages/email-sdk/package.json is ${latestPublishedVersion}, but current docs still track ${currentDocsVersion}.`,
  );
}

if (
  publishedMajor === currentDocsMajorVersion &&
  currentDocsPublishedVersion !== latestPublishedVersion
) {
  fail(
    `${latestPublishedVersion} should publish the ${currentDocsVersion} docs line, but the docs config does not expose it as the current published docs version.`,
  );
}

if (publishedMajor < currentDocsMajorVersion && currentDocsPublishedVersion !== undefined) {
  fail(
    `${latestPublishedVersion} must not be treated as a published package for the unreleased ${currentDocsVersion} docs line.`,
  );
}

// blume.config.ts builds `versions.archived` and the /docs/v/<release>
// redirects from archivedDocsVersions; make sure it still does.
for (const needle of [
  "archivedDocsVersions.map",
  "legacyArchivedVersionHref(version)",
  "versions: {",
]) {
  if (!blumeConfig.includes(needle)) {
    fail(
      `apps/docs/blume.config.ts no longer derives archived versions from lib/versions.ts (missing "${needle}").`,
    );
  }
}

const releases = new Set<string>();

for (const version of archivedDocsVersions) {
  if (releases.has(version.release)) fail(`Duplicate archived docs release: ${version.release}`);

  releases.add(version.release);

  if (version.id !== `v${version.release}`) {
    fail(`${version.release} archive id must be v${version.release}, got ${version.id}.`);
  }

  const contentDir = join(docsRoot, archivedVersionContentPath(version));

  if (!existsSync(join(contentDir, "index.mdx"))) {
    fail(
      `${version.id} archive is missing apps/docs/${archivedVersionContentPath(version)}/index.mdx.`,
    );
  }
}

// Every content/v*/ folder must be a listed archive, or Blume would serve it as
// ordinary pages.
for (const dirent of readdirSync(join(docsRoot, "content"), { withFileTypes: true })) {
  if (!dirent.isDirectory() || !/^v\d/.test(dirent.name)) continue;

  if (!archivedDocsVersions.some((version) => version.id === dirent.name)) {
    fail(`Archived docs folder content/${dirent.name} is not listed in apps/docs/lib/versions.ts.`);
  }
}

const changelogVersions = Array.from(changelog.matchAll(/^##\s+(\d+\.\d+\.\d+)/gm), (match) => {
  const version = match[1];

  if (!version) throw new Error("Unexpected changelog version match without a version.");

  return version;
});

for (const version of changelogVersions) {
  if (version === latestPublishedVersion) continue;

  if (!releases.has(version)) {
    fail(
      `CHANGELOG.md includes ${version}, but apps/docs/lib/versions.ts has no v${version} archive.`,
    );
  }
}

if (errors.length > 0) {
  console.error("Docs version validation failed:");

  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Docs version validation passed for ${currentDocsVersion} and ${archivedDocsVersions.map((version) => version.id).join(", ")}.`,
);
