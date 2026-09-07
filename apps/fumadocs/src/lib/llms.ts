import { llms } from "fumadocs-core/source";

import { comparePairs, getComparePairTitle } from "@/lib/compare";
import { absolutizeSiteLinks } from "@/lib/markdown-links";
import { appName, llmsOverview, siteUrl } from "@/lib/shared";
import { source } from "@/lib/source";

// The generated index leads with its own H1; drop it so callers can prepend an
// enriched header. Its links are root-relative, so absolutize them for readers
// that fetch the index without a page context. Single source of truth for both.
function docsIndex() {
  return absolutizeSiteLinks(
    llms(source)
      .index()
      .replace(/^#[^\n]*\r?\n+/, ""),
  );
}

const markdownHint = `Append \`.md\` to any documentation URL (for example ${siteUrl}/docs/adapters/resend.md) to fetch the same page as raw markdown.`;

// The generated index only walks the docs tree, so the comparison pages that
// answer "provider A vs provider B" were invisible to anything reading
// llms.txt. List them with the tools and the other machine-readable entry
// points instead of leaving them to sitemap discovery alone.
function comparisonsSection() {
  const pairs = comparePairs
    .map((pair) => `- [${getComparePairTitle(pair)}](${siteUrl}/compare/${pair.slug})`)
    .join("\n");

  return `## Provider comparisons

Per-pair message field support, fallback compatibility, and adapter code for both providers.

- [All provider comparisons](${siteUrl}/compare)
${pairs}`;
}

function toolsSection() {
  return `## Tools

- [Email DNS checker](${siteUrl}/tools/email-dns-checker): look up the SPF, DKIM, DMARC, and MX records of a sending domain.
- [All tools](${siteUrl}/tools)`;
}

function machineReadableSection() {
  return `## Machine-readable entry points

- [Agent guide](${siteUrl}/agents.md): install, send, and agent tool usage in one page.
- [Authentication model](${siteUrl}/auth.md): why there is no platform credential, and where provider credentials live.
- [Agent discovery](${siteUrl}/.well-known/agent.json) and [skill descriptor](${siteUrl}/.well-known/agent-skills).
- [Every documentation page inlined](${siteUrl}/llms-full.txt) and [documentation-only index](${siteUrl}/docs/llms.txt).
- [Blog](${siteUrl}/blog) with [RSS](${siteUrl}/rss.xml) and [JSON Feed](${siteUrl}/feed.json).`;
}

// One canonical machine index, shared by /llms.txt and its /llms.md twin so the
// enriched header (description + constraints) never drifts between the two URLs.
export function buildLlmsIndex() {
  return `# ${appName}

${llmsOverview}

## Documentation

${markdownHint}

${docsIndex()}

${comparisonsSection()}

${toolsSection()}

${machineReadableSection()}`;
}

// Section-scoped index for agents that only want the documentation tree, served
// at /docs/llms.txt so they can fetch docs context without the whole manual.
export function buildDocsLlmsIndex() {
  return `# ${appName} — Documentation

> Scoped index of the ${appName} documentation. For the full machine guide (overview, constraints, agent usage) see ${siteUrl}/llms.txt; for every page inlined see ${siteUrl}/llms-full.txt.

## Documentation

${markdownHint}

${docsIndex()}`;
}
