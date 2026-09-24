import { createFileRoute } from "@tanstack/react-router";

import { comparePairs, getComparePairTitle } from "@/lib/compare";
import { buildCompareDescription } from "@/lib/compare-page";
import docsLastmod from "@/lib/docs-lastmod.generated.json";
import { siteUrl } from "@/lib/shared";
import { source } from "@/lib/source";

// Schema.org content feed (JSON Lines) for NLWeb / natural-language retrieval.
// One schema.org TechArticle per documentation page so an indexer can ingest the
// docs as discrete, typed entities. Referenced from /schemamap.xml.
export const Route = createFileRoute("/feeds/docs.jsonl")({
  server: {
    handlers: {
      GET() {
        const lastmodByPath: Record<string, string> = docsLastmod;

        const lines = source.getPages().map((page) => {
          const url = `${siteUrl}${page.url}`;

          const entity = {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            "@id": `${url}#article`,
            url,
            mainEntityOfPage: url,
            headline: page.data.title,
            name: page.data.title,
            description: page.data.description,
            dateModified: lastmodByPath[page.path] ?? "2026-06-01",
            inLanguage: "en",
            isPartOf: { "@id": `${siteUrl}/#website` },
            author: { "@id": `${siteUrl}/#organization` },
            publisher: { "@id": `${siteUrl}/#organization` },
            encoding: {
              "@type": "MediaObject",
              encodingFormat: "text/markdown",
              contentUrl: `${siteUrl}${page.url}.md`,
            },
          };

          return JSON.stringify(entity);
        });

        const compareLines = comparePairs.map((pair) => {
          const url = `${siteUrl}/compare/${pair.slug}`;

          return JSON.stringify({
            "@context": "https://schema.org",
            "@type": "TechArticle",
            "@id": `${url}#article`,
            url,
            mainEntityOfPage: url,
            headline: getComparePairTitle(pair),
            name: getComparePairTitle(pair),
            description: buildCompareDescription(pair),
            dateModified: "2026-09-14",
            inLanguage: "en",
            isPartOf: { "@id": `${siteUrl}/#website` },
            author: { "@id": `${siteUrl}/#organization` },
            publisher: { "@id": `${siteUrl}/#organization` },
            encoding: {
              "@type": "MediaObject",
              encodingFormat: "text/markdown",
              contentUrl: `${url}.md`,
            },
          });
        });

        return new Response(`${[...lines, ...compareLines].join("\n")}\n`, {
          headers: { "content-type": "application/x-ndjson; charset=utf-8" },
        });
      },
    },
  },
});
