import { createFileRoute } from "@tanstack/react-router";

import { getBlogPostUrl, getPublishedBlogPosts } from "@/lib/blog";
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
  const posts = getPublishedBlogPosts();
  const items = posts.map((post) => {
    const url = `${siteUrl}${getBlogPostUrl(post.slug)}`;
    const escapedUrl = escapeXml(url);

    return `    <item>
      <title>${escapeXml(post.title)}</title>
      <link>${escapedUrl}</link>
      <guid>${escapedUrl}</guid>
      <description>${escapeXml(post.description)}</description>
      <pubDate>${new Date(`${post.publishedAt}T00:00:00Z`).toUTCString()}</pubDate>
    </item>`;
  });

  const latestPost = posts.reduce((latest, post) =>
    post.updatedAt > latest.updatedAt ? post : latest,
  );

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${escapeXml(`${appName} Blog`)}</title>
    <link>${escapeXml(`${siteUrl}/blog`)}</link>
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
