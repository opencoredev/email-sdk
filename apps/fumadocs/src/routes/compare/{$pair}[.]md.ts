import { createFileRoute } from "@tanstack/react-router";

import { getComparePair } from "@/lib/compare";
import { renderCompareMarkdown } from "@/lib/compare-page";

// Markdown mirror of each /compare/<pair> page at /compare/<pair>.md, matching
// the /docs/*.md convention so answer engines get the comparison content
// (field matrix, fallback gaps, code, FAQ) without parsing HTML.
export const Route = createFileRoute("/compare/{$pair}.md")({
  server: {
    handlers: {
      GET({ params }) {
        const pair = getComparePair(params.pair ?? "");
        if (!pair) {
          return new Response("Not found", { status: 404 });
        }

        return new Response(renderCompareMarkdown(pair), {
          headers: {
            "Content-Type": "text/markdown; charset=utf-8",
          },
        });
      },
    },
  },
});
