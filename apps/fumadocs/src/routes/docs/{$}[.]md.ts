import { createFileRoute, notFound, redirect } from "@tanstack/react-router";

import { getLatestDocsRedirect } from "@/lib/docs-redirects";
import { getDocsSource, getLLMText, markdownPathToSlugs } from "@/lib/source";
import { getDocsVersionBase, latestDocsVersion, resolveDocsVersionedSlugs } from "@/lib/versions";

export const Route = createFileRoute("/docs/{$}.md")({
  server: {
    handlers: {
      GET: async ({ params }) => {
        const slugs = markdownPathToSlugs(params._splat?.split("/") ?? []);
        const resolved = resolveDocsVersionedSlugs(slugs);

        const movedPage = resolved.version.current
          ? getLatestDocsRedirect(resolved.slugs)
          : undefined;

        if (movedPage) {
          throw redirect({
            href: `/docs/${movedPage}.md`,
            statusCode: 308,
          });
        }

        const page = getDocsSource(resolved.version).getPage(resolved.slugs);

        if (!page) {
          throw resolveMissingMarkdownPage(resolved);
        }

        const body = await getLLMText(page, resolved.version);

        if (resolved.version.current) {
          return new Response(body, {
            headers: { "Content-Type": "text/markdown" },
          });
        }

        // Old-version mirrors follow the HTML pages' noindex policy: the
        // text/markdown twins cannot carry a meta tag, so the policy moves to
        // a header. Keeps ~1k archived duplicates out of the index.
        return new Response(body, {
          headers: {
            "Content-Type": "text/markdown",
            "X-Robots-Tag": "noindex, follow",
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
