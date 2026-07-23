import { createFileRoute } from "@tanstack/react-router";

import { getBlogPostUrl, getPublishedBlogPosts } from "@/lib/blog";
import { siteUrl } from "@/lib/shared";
import { buildSitemapEntries, renderSitemap } from "@/lib/sitemap";
import { getDocsSource } from "@/lib/source";
import { latestDocsVersion } from "@/lib/versions";

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

const v1LaunchLastModified = "2026-07-22";

export function getSitemapEntries() {
  const publishedBlogPosts = getPublishedBlogPosts();
  const latestBlogUpdate =
    publishedBlogPosts.reduce(
      (latest, post) => (post.updatedAt > latest ? post.updatedAt : latest),
      "2026-06-01",
    ) || "2026-06-01";
  const docsSource = getDocsSource(latestDocsVersion);

  return buildSitemapEntries({
    siteUrl,
    launchLastModified: v1LaunchLastModified,
    blogLastModified: latestBlogUpdate,
    blogPosts: publishedBlogPosts.map((post) => ({
      url: getBlogPostUrl(post.slug),
      lastmod: post.updatedAt,
    })),
    docsPages: docsSource.getPages().map((page) => ({
      url: page.url,
      lastmod: v1LaunchLastModified,
    })),
  });
}
