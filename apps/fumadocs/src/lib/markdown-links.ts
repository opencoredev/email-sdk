import { siteUrl } from "./shared";

// Markdown mirrors (/docs/**.md, /llms.txt, /llms-full.txt, /docs/llms.txt) are
// fetched on their own, without the page that linked to them, so a root-relative
// target has no origin to resolve against: an answer engine holding
// "](/docs/adapters/field-support)" cannot follow it or cite it. Rewrite every
// site-root link to an absolute URL. Protocol-relative targets (//host/path)
// already resolve, so they are left alone.
const rootRelativeMarkdownLink = /\]\((\/(?!\/))/g;
const rootRelativeHref = /href="(\/(?!\/))/g;

export function absolutizeSiteLinks(markdown: string) {
  return markdown
    .replace(rootRelativeMarkdownLink, `](${siteUrl}$1`)
    .replace(rootRelativeHref, `href="${siteUrl}$1`);
}
