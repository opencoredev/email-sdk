import { createFileRoute } from "@tanstack/react-router";

import { getBlogPostUrl, getPublishedBlogPosts } from "@/lib/blog";
import { comparePairLastmod, comparePairs, getComparePairTitle } from "@/lib/compare";
import { buildCompareDescription } from "@/lib/compare-page";
import docsLastmod from "@/lib/docs-lastmod.generated.json";
import { siteUrl } from "@/lib/shared";
import { source } from "@/lib/source";

// Schema.org content feed (JSON Lines) for NLWeb / natural-language retrieval.
// One schema.org TechArticle per documentation and comparison page plus one
// BlogPosting per post, so an indexer can ingest the site as discrete, typed
// entities. Referenced from /schemamap.xml.
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
            dateModified: comparePairLastmod(pair),
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

        // Blog posts render on demand from the build-time snapshot, so the feed
        // lists the same posts as the sitemap and RSS built from that source.
        const blogLines = getPublishedBlogPosts().map((post) => {
          const url = `${siteUrl}${getBlogPostUrl(post.slug)}`;

          return JSON.stringify({
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "@id": `${url}#article`,
            url,
            mainEntityOfPage: url,
            headline: post.title,
            name: post.title,
            description: post.description,
            datePublished: post.publishedAt,
            dateModified: post.updatedAt,
            image: `${siteUrl}${post.image}`,
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

        return new Response(`${[...lines, ...compareLines, ...blogLines].join("\n")}\n`, {
          headers: { "content-type": "application/x-ndjson; charset=utf-8" },
        });
      },
    },
  },
});
