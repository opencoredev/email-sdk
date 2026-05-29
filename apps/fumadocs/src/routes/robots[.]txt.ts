import { createFileRoute } from "@tanstack/react-router";

import { siteUrl } from "@/lib/shared";

export const Route = createFileRoute("/robots.txt")({
  server: {
    handlers: {
      GET() {
        return new Response(
          [
            "User-agent: *",
            "Allow: /",
            "",
            "User-agent: GPTBot",
            "Allow: /",
            "",
            "User-agent: ChatGPT-User",
            "Allow: /",
            "",
            "User-agent: OAI-SearchBot",
            "Allow: /",
            "",
            "User-agent: ClaudeBot",
            "Allow: /",
            "",
            "User-agent: Claude-User",
            "Allow: /",
            "",
            "User-agent: Claude-SearchBot",
            "Allow: /",
            "",
            "User-agent: PerplexityBot",
            "Allow: /",
            "",
            `Sitemap: ${siteUrl}/sitemap.xml`,
          ].join("\n"),
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
