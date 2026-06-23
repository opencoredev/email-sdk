import emailSdkPackage from "../../../../packages/email-sdk/package.json";

export const sdkPackageName = emailSdkPackage.name;
export const latestPublishedVersion = emailSdkPackage.version;
export const docsVersion = `v${latestPublishedVersion}`;
export const docsVersionRoutePrefix = "v";
export const docsVersionStorageKey = "email-sdk-docs-version";

export const docsVersions = [
  {
    label: "latest",
    version: docsVersion,
    description: "Current SDK, CLI, and docs",
    href: "/docs",
    collection: "docs",
    contentPath: "content/docs",
    current: true,
    external: false,
  },
  {
    label: "v0.6.1",
    version: "v0.6.1",
    description: "Docs for the v0.6.1 patch release",
    href: "/docs/v/0.6.1",
    collection: "docsV061",
    contentPath: "content/docs-v/0.6.1",
    current: false,
    external: false,
  },
  {
    label: "v0.6.0",
    version: "v0.6.0",
    description: "Docs for the v0.6 public package",
    href: "/docs/v/0.6.0",
    collection: "docsV060",
    contentPath: "content/docs-v/0.6.0",
    current: false,
    external: false,
  },
  {
    label: "v0.5.0",
    version: "v0.5.0",
    description: "Docs for the v0.5 public package",
    href: "/docs/v/0.5.0",
    collection: "docsV050",
    contentPath: "content/docs-v/0.5.0",
    current: false,
    external: false,
  },
  {
    label: "v0.4.0",
    version: "v0.4.0",
    description: "Docs for the v0.4 public package",
    href: "/docs/v/0.4.0",
    collection: "docsV040",
    contentPath: "content/docs-v/0.4.0",
    current: false,
    external: false,
  },
  {
    label: "v0.3.0",
    version: "v0.3.0",
    description: "Plugin system release docs",
    href: "/docs/v/0.3.0",
    collection: "docsV030",
    contentPath: "content/docs-v/0.3.0",
    current: false,
    external: false,
  },
  {
    label: "v0.2.1",
    version: "v0.2.1",
    description: "Docs for the pre-plugin public package",
    href: "/docs/v/0.2.1",
    collection: "docsV021",
    contentPath: "content/docs-v/0.2.1",
    current: false,
    external: false,
  },
  {
    label: "v0.2.0",
    version: "v0.2.0",
    description: "Package docs for the first public scoped release",
    href: "/docs/v/0.2.0",
    collection: "docsV020",
    contentPath: "content/docs-v/0.2.0",
    current: false,
    external: false,
  },
] as const;

export type DocsVersion = (typeof docsVersions)[number];

export const latestDocsVersion = docsVersions[0];

export type DocsVersionCollection = DocsVersion["collection"];

export function getDocsVersionBySlug(slug: string) {
  return docsVersions.find((version) => getDocsVersionSlug(version) === slug);
}

export function getDocsVersionByStoredValue(value: string | null | undefined) {
  if (!value) return undefined;

  return getDocsVersionBySlug(value.replace(/^v/, ""));
}

export function getDocsVersionSlug(version: DocsVersion) {
  return version.version.replace(/^v/, "");
}

export function getDocsVersionBase(version: DocsVersion) {
  return version.href;
}

export function resolveDocsVersionedSlugs(slugs: string[]) {
  if (slugs[0] !== docsVersionRoutePrefix || !slugs[1]) {
    return {
      version: latestDocsVersion,
      slugs,
    };
  }

  const version = getDocsVersionBySlug(slugs[1]);
  if (!version) {
    return {
      version: latestDocsVersion,
      slugs: slugs.slice(2),
    };
  }

  return {
    version,
    slugs: slugs.slice(2),
  };
}

export function getDocsVersionHref(version: DocsVersion, pathname = "/docs") {
  const cleanPathname = pathname.split(/[?#]/, 1)[0] ?? "/docs";
  const docsPath = cleanPathname.startsWith("/docs") ? cleanPathname : "/docs";
  const slugs = docsPath
    .replace(/^\/docs\/?/, "")
    .split("/")
    .filter(Boolean);
  const resolved = resolveDocsVersionedSlugs(slugs);
  const pageSlugs = resolved.slugs.join("/");

  if (version.current) {
    return pageSlugs ? `/docs/${pageSlugs}` : "/docs";
  }

  const versionBase = getDocsVersionBase(version);
  return pageSlugs ? `${versionBase}/${pageSlugs}` : versionBase;
}

export function getDocsVersionFromPathname(pathname: string) {
  const slugs = pathname
    .replace(/^\/docs\/?/, "")
    .split("/")
    .filter(Boolean);

  return resolveDocsVersionedSlugs(slugs).version;
}

export function getVersionLinks(version: DocsVersion) {
  return [
    {
      label: "npm package",
      href: `https://www.npmjs.com/package/${sdkPackageName}/v/${getDocsVersionSlug(version)}`,
    },
    {
      label: "Changelog",
      href: "https://github.com/opencoredev/email-sdk/blob/main/packages/email-sdk/CHANGELOG.md",
    },
  ] as const;
}

export const versionLinks = getVersionLinks(latestDocsVersion);
