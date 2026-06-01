import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { getDocsSource, getLLMText, markdownPathToSlugs } from "@/lib/source";
import { getDocsVersionBase, latestDocsVersion, resolveDocsVersionedSlugs } from "@/lib/versions";

export const Route = createFileRoute("/docs/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = markdownPathToSlugs(params._splat?.split("/") ?? []);
        const resolved = resolveDocsVersionedSlugs(slugs);
        const page = getDocsSource(resolved.version).getPage(resolved.slugs);
        if (!page) {
          throw resolveMissingMarkdownPage(resolved);
        }

        return new Response(await getLLMText(page, resolved.version), {
          headers: {
            "Content-Type": "text/markdown",
          },
        });
      },
    },
  },
});

function resolveMissingMarkdownPage(resolved: ReturnType<typeof resolveDocsVersionedSlugs>) {
  if (resolved.version.current) return notFound();

  const latestPage = getDocsSource(latestDocsVersion).getPage(resolved.slugs);
  if (latestPage) {
    const suffix =
      resolved.slugs.length > 0 ? `${resolved.slugs.join("/")}.md` : "index.md";

    return redirect({
      href: `${getDocsVersionBase(latestDocsVersion)}/${suffix}`,
      statusCode: 302,
    });
  }

  return redirect({
    href: `${getDocsVersionBase(resolved.version)}/index.md`,
    statusCode: 302,
  });
}
