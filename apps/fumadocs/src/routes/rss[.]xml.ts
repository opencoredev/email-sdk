import { createFileRoute } from "@tanstack/react-router";

import { blogPosts, getBlogPostUrl } from "@/lib/blog";
import { appDescription, appName, siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/rss.xml")({
  server: {
    handlers: {
      GET() {
        return new Response(renderRssFeed(), {
          headers: {
            "content-type": "application/rss+xml; charset=utf-8",
          },
        });
      },
    },
  },
});

function renderRssFeed() {
  const items = blogPosts.map((post) => {
    const url = `${siteUrl}${getBlogPostUrl(post.slug)}`;

    return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${url}</link>
      <guid>${url}</guid>
      <description>${escapeXml(post.description)}</description>
      <pubDate>${new Date(`${post.publishedAt}T00:00:00Z`).toUTCString()}</pubDate>
    </item>`;
  });

  const latestPost = blogPosts.reduce((latest, post) =>
    post.updatedAt > latest.updatedAt ? post : latest,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(`${appName} Blog`)}</title>
    <link>${siteUrl}/blog</link>
    <description>${escapeXml(appDescription)}</description>
    <language>en</language>
    <lastBuildDate>${new Date(`${latestPost.updatedAt}T00:00:00Z`).toUTCString()}</lastBuildDate>
${items.join("\n")}
  </channel>
</rss>`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
