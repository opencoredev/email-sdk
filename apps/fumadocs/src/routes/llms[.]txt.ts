import { createFileRoute } from "@tanstack/react-router";

import { buildLlmsIndex } from "@/lib/llms";

export const Route = createFileRoute("/llms.txt")({
  server: {
    handlers: {
      GET() {
        return new Response(buildLlmsIndex(), {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
