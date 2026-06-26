import { createFileRoute } from "@tanstack/react-router";

import { buildDocsLlmsIndex } from "@/lib/llms";

// Per-section machine index so agents can fetch documentation-scoped context
// (/docs/llms.txt) instead of the whole-site /llms.txt manual.
export const Route = createFileRoute("/docs/llms.txt")({
  server: {
    handlers: {
      GET() {
        return new Response(buildDocsLlmsIndex(), {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
