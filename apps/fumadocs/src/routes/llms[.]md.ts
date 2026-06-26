import { createFileRoute } from "@tanstack/react-router";

import { buildLlmsIndex } from "@/lib/llms";

// Markdown twin of /llms.txt. Cold-arrival agents that land from web search and
// probe for a markdown representation (/llms.md) get the same canonical index
// with a text/markdown content-type instead of having to know about llms.txt.
export const Route = createFileRoute("/llms.md")({
  server: {
    handlers: {
      GET() {
        return new Response(buildLlmsIndex(), {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
          },
        });
      },
    },
  },
});
