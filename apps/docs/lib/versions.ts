import emailSdkPackage from "../../../packages/email-sdk/package.json" with { type: "json" };

export const sdkPackageName = emailSdkPackage.name;

export const latestPublishedVersion = emailSdkPackage.version;

export const currentDocsMajorVersion = 3;

export const docsVersion = `v${currentDocsMajorVersion}`;

export function getCurrentDocsPublishedVersion(packageVersion: string) {
  return packageVersion.startsWith(`${currentDocsMajorVersion}.`) ? packageVersion : undefined;
}

export const currentDocsPublishedVersion = getCurrentDocsPublishedVersion(latestPublishedVersion);

/**
 * Frozen docs snapshots, newest first. Each one is a Blume archived version:
 * its pages live in `content/<id>/docs/` and are served at `/<id>/docs/...`.
 * The Fumadocs site served them at `/docs/v/<release>/...`; blume.config.ts
 * redirects those URLs here.
 */
export const archivedDocsVersions = [
  { id: "v3.0.1", release: "3.0.1", description: "Docs for the v3.0.1 release" },
  { id: "v3.0.0", release: "3.0.0", description: "Docs for the v3.0.0 release" },
  { id: "v2.0.0", release: "2.0.0", description: "Docs for the v2.0.0 release" },
  { id: "v1.2.0", release: "1.2.0", description: "Docs for the v1.2.0 release" },
  { id: "v1.1.0", release: "1.1.0", description: "Docs for the v1.1.0 minor release" },
  { id: "v1.0.1", release: "1.0.1", description: "Docs for the v1.0.1 patch release" },
  { id: "v1.0.0", release: "1.0.0", description: "Docs for the v1.0.0 release" },
  { id: "v0.6.5", release: "0.6.5", description: "Docs for the v0.6.5 patch release" },
  { id: "v0.6.4", release: "0.6.4", description: "Docs for the v0.6.4 patch release" },
  { id: "v0.6.3", release: "0.6.3", description: "Docs for the v0.6.3 patch release" },
  { id: "v0.6.2", release: "0.6.2", description: "Docs for the v0.6.2 patch release" },
  { id: "v0.6.1", release: "0.6.1", description: "Docs for the v0.6.1 patch release" },
  { id: "v0.6.0", release: "0.6.0", description: "Docs for the v0.6.0 release" },
  { id: "v0.5.0", release: "0.5.0", description: "Docs for the v0.5.0 release" },
  { id: "v0.4.0", release: "0.4.0", description: "Docs for the v0.4.0 release" },
  { id: "v0.3.0", release: "0.3.0", description: "Docs for the v0.3.0 release" },
  { id: "v0.2.1", release: "0.2.1", description: "Docs for the pre-plugin public package" },
  {
    id: "v0.2.0",
    release: "0.2.0",
    description: "Package docs for the first public scoped release",
  },
] as const;

export type ArchivedDocsVersion = (typeof archivedDocsVersions)[number];

export const currentDocsLabel = currentDocsPublishedVersion ? "latest" : `${docsVersion} preview`;

/** The content directory of an archived version, relative to apps/docs. */
export function archivedVersionContentPath(version: ArchivedDocsVersion) {
  return `content/${version.id}/docs`;
}

/** Where the Fumadocs site served an archived version. */
export function legacyArchivedVersionHref(version: ArchivedDocsVersion) {
  return `/docs/v/${version.release}`;
}

/** Where the Blume site serves an archived version. */
export function archivedVersionHref(version: ArchivedDocsVersion) {
  return `/${version.id}/docs`;
}
