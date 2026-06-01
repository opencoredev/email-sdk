import { docs, docsV020, docsV021 } from "collections/server";
import { loader } from "fumadocs-core/source";

import { resolveDocsIcon } from "./docs-icons";
import { docsRoute } from "./shared";
import { type DocsVersion, docsVersions, getDocsVersionBase, latestDocsVersion } from "./versions";

const v020DocsVersion = docsVersions.find((version) => version.collection === "docsV020");
if (!v020DocsVersion) {
  throw new Error("Missing docs source config for v0.2.0");
}

const v021DocsVersion = docsVersions.find((version) => version.collection === "docsV021");
if (!v021DocsVersion) {
  throw new Error("Missing docs source config for v0.2.1");
}

const sources = {
  docs: loader({
    source: docs.toFumadocsSource(),
    baseUrl: docsRoute,
    icon: resolveDocsIcon,
  }),
  docsV021: loader({
    source: docsV021.toFumadocsSource(),
    baseUrl: getDocsVersionBase(v021DocsVersion),
    icon: resolveDocsIcon,
  }),
  docsV020: loader({
    source: docsV020.toFumadocsSource(),
    baseUrl: getDocsVersionBase(v020DocsVersion),
    icon: resolveDocsIcon,
  }),
};

export const source = sources[latestDocsVersion.collection];

export function getDocsSource(version: DocsVersion) {
  return sources[version.collection];
}

export function markdownPathToSlugs(segs: string[]) {
  if (segs.length === 0) return [];

  const out = [...segs];
  out[out.length - 1] = out[out.length - 1].replace(/\.md$/, "");
  if (out[out.length - 1] === "index") out.pop();
  return out;
}

export function slugsToMarkdownPath(slugs: string[], version: DocsVersion = latestDocsVersion) {
  const segments = [...slugs];
  if (segments.length === 0) {
    segments.push("index.md");
  } else {
    segments[segments.length - 1] += ".md";
  }

  return {
    segments,
    url: `${getDocsVersionBase(version)}/${segments.join("/")}`,
  };
}

export function getPageMarkdownUrl(slugs: string[]) {
  const segments = [...slugs];
  if (segments.length === 0) {
    segments.push("index.md");
  } else {
    segments[segments.length - 1] += ".md";
  }

  return {
    segments,
    url: `${docsRoute}/${segments.join("/")}`,
  };
}

export async function getLLMText(
  page: (typeof source)["$inferPage"],
  version: DocsVersion = latestDocsVersion,
) {
  const docsBasePath = getDocsVersionBase(version);
  const processed = (await page.data.getText("processed"))
    .replaceAll("](/docs/", `](${docsBasePath}/`)
    .replaceAll('href="/docs/', `href="${docsBasePath}/`);

  return `# ${page.data.title} (${page.url})

${processed}`;
}
