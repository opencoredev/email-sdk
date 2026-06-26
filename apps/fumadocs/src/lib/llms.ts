import { llms } from "fumadocs-core/source";

import { appName, llmsOverview } from "@/lib/shared";
import { source } from "@/lib/source";

// One canonical machine index, shared by /llms.txt and its /llms.md twin so the
// enriched header (description + constraints) never drifts between the two URLs.
export function buildLlmsIndex() {
  // Drop the generated H1 and lead with our enriched header.
  const index = llms(source)
    .index()
    .replace(/^#[^\n]*\r?\n+/, "");

  return `# ${appName}\n\n${llmsOverview}\n\n## Documentation\n\n${index}`;
}

// Section-scoped index for agents that only want the documentation tree, served
// at /docs/llms.txt so they can fetch docs context without the whole manual.
export function buildDocsLlmsIndex() {
  const index = llms(source)
    .index()
    .replace(/^#[^\n]*\r?\n+/, "");

  return `# ${appName} — Documentation

> Scoped index of the ${appName} documentation. For the full machine guide (overview, constraints, agent usage) see /llms.txt; for every page inlined see /llms-full.txt.

## Documentation

${index}`;
}
