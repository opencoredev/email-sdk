import { createFileRoute } from "@tanstack/react-router";

import { getBlogPostUrl, getPublishedBlogPosts } from "@/lib/blog";
import { comparePairs } from "@/lib/compare";
import docsLastmod from "@/lib/docs-lastmod.generated.json";
import { siteUrl } from "@/lib/shared";
import { getDocsSource } from "@/lib/source";
import { latestDocsVersion } from "@/lib/versions";

type SitemapEntry = {
  loc: string;
  lastmod: string;
  changefreq: "daily" | "weekly" | "monthly";
  priority: string;
};

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET() {
        return new Response(renderSitemap(getSitemapEntries()), {
          headers: {
            "content-type": "application/xml; charset=utf-8",
          },
        });
      },
    },
  },
});

function getSitemapEntries() {
  const publishedBlogPosts = getPublishedBlogPosts();
  const latestBlogUpdate =
    publishedBlogPosts.reduce(
      (latest, post) => (post.updatedAt > latest ? post.updatedAt : latest),
      "2026-06-01",
    ) || "2026-06-01";
  const entries: SitemapEntry[] = [
    {
      loc: `${siteUrl}/`,
      lastmod: "2026-06-01",
      changefreq: "weekly",
      priority: "1.0",
    },
    {
      loc: `${siteUrl}/blog`,
      lastmod: latestBlogUpdate,
      changefreq: "weekly",
      priority: "0.8",
    },
    {
      loc: `${siteUrl}/about`,
      lastmod: "2026-06-01",
      changefreq: "monthly",
      priority: "0.5",
    },
    {
      loc: `${siteUrl}/contact`,
      lastmod: "2026-06-01",
      changefreq: "monthly",
      priority: "0.5",
    },
    {
      loc: `${siteUrl}/privacy`,
      lastmod: "2026-06-01",
      changefreq: "monthly",
      priority: "0.3",
    },
    {
      loc: `${siteUrl}/terms`,
      lastmod: "2026-06-01",
      changefreq: "monthly",
      priority: "0.3",
    },
    {
      loc: `${siteUrl}/compare`,
      lastmod: "2026-07-11",
      changefreq: "monthly",
      priority: "0.7",
    },
    ...comparePairs.map((pair) => ({
      loc: `${siteUrl}/compare/${pair.slug}`,
      lastmod: "2026-07-11",
      changefreq: "monthly" as const,
      priority: "0.7",
    })),
    {
      loc: `${siteUrl}/tools`,
      lastmod: "2026-07-11",
      changefreq: "monthly",
      priority: "0.6",
    },
    {
      loc: `${siteUrl}/tools/email-dns-checker`,
      lastmod: "2026-07-11",
      changefreq: "monthly",
      priority: "0.7",
    },
    ...publishedBlogPosts.map((post) => ({
      loc: `${siteUrl}${getBlogPostUrl(post.slug)}`,
      lastmod: post.updatedAt,
      changefreq: "monthly" as const,
      priority: "0.8",
    })),
    {
      loc: `${siteUrl}/llms.txt`,
      lastmod: "2026-06-01",
      changefreq: "weekly",
      priority: "0.5",
    },
    {
      loc: `${siteUrl}/llms-full.txt`,
      lastmod: "2026-06-01",
      changefreq: "weekly",
      priority: "0.5",
    },
    {
      loc: `${siteUrl}/rss.xml`,
      lastmod: "2026-06-01",
      changefreq: "weekly",
      priority: "0.3",
    },
    {
      loc: `${siteUrl}/feed.json`,
      lastmod: "2026-06-01",
      changefreq: "weekly",
      priority: "0.3",
    },
  ];

  // Only the current docs version is listed: old /docs/v/<x> snapshots are
  // near-duplicates that carry noindex and would dilute crawl priority.
  const docsSource = getDocsSource(latestDocsVersion);
  const lastmodByPath: Record<string, string> = docsLastmod;
  for (const page of docsSource.getPages()) {
    entries.push({
      loc: `${siteUrl}${page.url}`,
      lastmod: lastmodByPath[page.path] ?? "2026-06-01",
      changefreq: "weekly",
      priority: "0.8",
    });
  }

  return dedupeEntries(entries);
}

function dedupeEntries(entries: SitemapEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.loc)) return false;
    seen.add(entry.loc);
    return true;
  });
}

function renderSitemap(entries: SitemapEntry[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(renderEntry).join("\n")}
</urlset>`;
}

function renderEntry(entry: SitemapEntry) {
  return `  <url><loc>${escapeXml(entry.loc)}</loc><lastmod>${entry.lastmod}</lastmod><changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority></url>`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
