import { createFileRoute } from "@tanstack/react-router";

import { comparePairs } from "@/lib/compare";
import { renderCompareMarkdown } from "@/lib/compare-page";
import { appName, llmsOverview, siteUrl } from "@/lib/shared";
import { source, getLLMText } from "@/lib/source";

export const Route = createFileRoute("/llms-full.txt")({
  server: {
    handlers: {
      GET: async () => {
        const scan = source.getPages().map((page) => getLLMText(page));
        const scanned = await Promise.all(scan);
        // The head-to-head comparisons answer "provider A vs B" questions, so
        // the single-file corpus inlines them the same way it inlines docs.
        const comparisons = comparePairs.map(renderCompareMarkdown).join("\n\n");

        const body = `# ${appName}\n\n${llmsOverview}\n\n---\n\n${scanned.join(
          "\n\n",
        )}\n\n---\n\n# Provider comparisons\n\nEvery head-to-head comparison from ${siteUrl}/compare, inlined. Each document links back to its canonical HTML page.\n\n${comparisons}`;

        return new Response(body, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        });
      },
    },
  },
});
