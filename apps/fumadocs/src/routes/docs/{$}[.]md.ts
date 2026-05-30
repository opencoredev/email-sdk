import { createFileRoute, notFound } from "@tanstack/react-router";

import { getDocsSource, getLLMText, markdownPathToSlugs } from "@/lib/source";
import { resolveDocsVersionedSlugs } from "@/lib/versions";

export const Route = createFileRoute("/docs/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = markdownPathToSlugs(params._splat?.split("/") ?? []);
        const resolved = resolveDocsVersionedSlugs(slugs);
        const page = getDocsSource(resolved.version).getPage(resolved.slugs);
        if (!page) throw notFound();

        return new Response(await getLLMText(page, resolved.version), {
          headers: {
            "Content-Type": "text/markdown",
          },
        });
      },
    },
  },
});
