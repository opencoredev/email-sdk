import { createFileRoute } from "@tanstack/react-router";

import { blogPosts, getBlogPostUrl } from "@/lib/blog";
import { appDescription, appName, siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/feed.json")({
  server: {
    handlers: {
      GET() {
        return Response.json(renderJsonFeed(), {
          headers: {
            "content-type": "application/feed+json; charset=utf-8",
          },
        });
      },
    },
  },
});

function renderJsonFeed() {
  return {
    version: "https://jsonfeed.org/version/1.1",
    title: `${appName} Blog`,
    home_page_url: siteUrl,
    feed_url: `${siteUrl}/feed.json`,
    description: appDescription,
    language: "en",
    items: blogPosts.map((post) => {
      const url = `${siteUrl}${getBlogPostUrl(post.slug)}`;

      return {
        id: url,
        url,
        title: post.title,
        summary: post.description,
        image: `${siteUrl}${post.image}`,
        date_published: `${post.publishedAt}T00:00:00.000Z`,
        date_modified: `${post.updatedAt}T00:00:00.000Z`,
        tags: post.tags,
      };
    }),
  };
}
