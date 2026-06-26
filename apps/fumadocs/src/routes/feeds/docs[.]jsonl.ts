import { createFileRoute } from "@tanstack/react-router";

import { siteUrl } from "@/lib/shared";
import { source } from "@/lib/source";

// Schema.org content feed (JSON Lines) for NLWeb / natural-language retrieval.
// One schema.org TechArticle per documentation page so an indexer can ingest the
// docs as discrete, typed entities. Referenced from /schemamap.xml.
export const Route = createFileRoute("/feeds/docs.jsonl")({
  server: {
    handlers: {
      GET() {
        const lines = source.getPages().map((page) => {
          const entity = {
            "@context": "https://schema.org",
            "@type": "TechArticle",
            "@id": `${siteUrl}${page.url}`,
            url: `${siteUrl}${page.url}`,
            name: page.data.title,
            description: page.data.description,
            inLanguage: "en",
            isPartOf: { "@id": `${siteUrl}/#website` },
            encoding: {
              "@type": "MediaObject",
              encodingFormat: "text/markdown",
              contentUrl: `${siteUrl}${page.url}.md`,
            },
          };

          return JSON.stringify(entity);
        });

        return new Response(`${lines.join("\n")}\n`, {
          headers: { "content-type": "application/x-ndjson; charset=utf-8" },
        });
      },
    },
  },
});
