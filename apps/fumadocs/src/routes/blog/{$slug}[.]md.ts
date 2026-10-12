import { createFileRoute } from "@tanstack/react-router";

import { renderBlogPostMarkdown } from "@/lib/blog-markdown";
import { getBlogPostMarkdownServerFn } from "@/lib/notra-runtime";

// Markdown mirror of each /blog/<slug> post at /blog/<slug>.md, matching the
// /docs/*.md and /compare/<pair>.md conventions so answer engines get the post
// source instead of parsing the rendered page.
export const Route = createFileRoute("/blog/{$slug}.md")({
  server: {
    handlers: {
      async GET({ params }) {
        const detail = await getBlogPostMarkdownServerFn({ data: params.slug ?? "" });

        if (!detail) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(renderBlogPostMarkdown(detail.post, detail.markdown), {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
          },
        });
      },
    },
  },
});
