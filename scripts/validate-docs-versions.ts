import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  currentDocsMajorVersion,
  docsVersions,
  getCurrentDocsPublishedVersion,
  latestPublishedVersion as packageJsonVersion,
} from "../apps/fumadocs/src/lib/versions";

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const fumadocsRoot = join(repoRoot, "apps/fumadocs");
const errors: string[] = [];

function fail(message: string) {
  errors.push(message);
}

function readRepoFile(path: string) {
  return readFileSync(join(repoRoot, path), "utf8");
}

const sourceConfig = readRepoFile("apps/fumadocs/source.config.ts");
const sourceLoader = readRepoFile("apps/fumadocs/src/lib/source.ts");
const docsRoute = readRepoFile("apps/fumadocs/src/routes/docs/$.tsx");
const changelog = readRepoFile("packages/email-sdk/CHANGELOG.md");
const latestPublishedVersion =
  process.env.EMAIL_SDK_VALIDATE_DOCS_PACKAGE_VERSION ?? packageJsonVersion;
const currentDocsVersion = `v${currentDocsMajorVersion}`;

if (!/^\d+\.\d+\.\d+$/.test(latestPublishedVersion)) {
  fail(
    `Package version must be an exact SemVer release, got ${latestPublishedVersion}.` +
      " Set EMAIL_SDK_VALIDATE_DOCS_PACKAGE_VERSION only to simulate a future package.json version.",
  );
}

const latest = docsVersions.find((version) => version.current);
if (!latest) {
  fail("docsVersions must include a current version.");
} else {
  if (latest.version !== currentDocsVersion) {
    fail(
      `Current docs version must be ${currentDocsVersion}, got ${latest.version}. ` +
        "Active docs track the v1 docs line while patch releases live in content/docs-v archives.",
    );
  }

  const publishedMajor = Number(latestPublishedVersion.split(".", 1)[0]);
  const currentDocsPublishedVersion = getCurrentDocsPublishedVersion(latestPublishedVersion);

  if (publishedMajor > currentDocsMajorVersion) {
    fail(
      `packages/email-sdk/package.json is ${latestPublishedVersion}, but current docs still track ${currentDocsVersion}.`,
    );
  }
  if (publishedMajor === currentDocsMajorVersion && currentDocsPublishedVersion !== latestPublishedVersion) {
    fail(
      `${latestPublishedVersion} should publish the ${currentDocsVersion} docs line, but the docs config does not expose it as the current published docs version.`,
    );
  }
  if (publishedMajor < currentDocsMajorVersion && currentDocsPublishedVersion !== undefined) {
    fail(
      `${latestPublishedVersion} must not be treated as a published package for the unreleased ${currentDocsVersion} docs line.`,
    );
  }
}

const versionsBySlug = new Map<string, (typeof docsVersions)[number]>();
const collections = new Set<string>();

for (const version of docsVersions) {
  const slug = version.version.replace(/^v/, "");

  if (versionsBySlug.has(slug)) {
    fail(`Duplicate docs version slug: ${slug}`);
  }
  versionsBySlug.set(slug, version);

  if (collections.has(version.collection)) {
    fail(`Duplicate docs version collection: ${version.collection}`);
  }
  collections.add(version.collection);

  if (version.current) {
    if (version.href !== "/docs") fail(`Current docs href must be /docs, got ${version.href}.`);
    if (version.contentPath !== "content/docs") {
      fail(`Current docs contentPath must be content/docs, got ${version.contentPath}.`);
    }
    continue;
  }

  const expectedHref = `/docs/v/${slug}`;
  const expectedContentPath = `content/docs-v/${slug}`;
  const contentDir = join(fumadocsRoot, version.contentPath);

  if (version.href !== expectedHref) {
    fail(`${version.version} href must be ${expectedHref}, got ${version.href}.`);
  }
  if (version.contentPath !== expectedContentPath) {
    fail(`${version.version} contentPath must be ${expectedContentPath}, got ${version.contentPath}.`);
  }
  if (!existsSync(contentDir)) {
    fail(`${version.version} content directory is missing: apps/fumadocs/${version.contentPath}`);
  }
  if (!existsSync(join(contentDir, "index.mdx"))) {
    fail(`${version.version} archive is missing index.mdx.`);
  }
  if (!sourceConfig.includes(`export const ${version.collection}`)) {
    fail(`${version.version} is missing export const ${version.collection} in source.config.ts.`);
  }
  if (!sourceConfig.includes(`dir: "${version.contentPath}"`)) {
    fail(`${version.version} source.config.ts entry must point at ${version.contentPath}.`);
  }
  if (!sourceLoader.includes(`${version.collection}: loader(`)) {
    fail(`${version.version} is missing a ${version.collection} loader in src/lib/source.ts.`);
  }
  if (!docsRoute.includes(`browserCollections.${version.collection}`)) {
    fail(`${version.version} is missing a browser loader in src/routes/docs/$.tsx.`);
  }
}

const archiveDir = join(fumadocsRoot, "content/docs-v");
for (const dirent of readdirSync(archiveDir, { withFileTypes: true })) {
  if (!dirent.isDirectory()) continue;
  if (!versionsBySlug.has(dirent.name)) {
    fail(`Archived docs folder ${dirent.name} is not listed in docsVersions.`);
  }
}

const changelogVersions = Array.from(changelog.matchAll(/^##\s+(\d+\.\d+\.\d+)/gm), (match) => {
  const version = match[1];
  if (!version) throw new Error("Unexpected changelog version match without a version.");
  return version;
});

for (const version of changelogVersions) {
  if (version === latestPublishedVersion) continue;
  if (!versionsBySlug.has(version)) {
    fail(`CHANGELOG.md includes ${version}, but docsVersions has no v${version} archive.`);
  }
}

if (errors.length > 0) {
  console.error("Docs version validation failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log(
  `Docs version validation passed for ${docsVersions.map((version) => version.version).join(", ")}.`,
);
