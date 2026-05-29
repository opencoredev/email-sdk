import { createFileRoute } from "@tanstack/react-router";

import { siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET() {
        return new Response(
          ["User-agent: *", "Allow: /", "", `Sitemap: ${siteUrl}/sitemap.xml`].join("\n"),
          {
            headers: {
              "Content-Type": "text/plain; charset=utf-8",
            },
          },
        );
      },
    },
  },
});
