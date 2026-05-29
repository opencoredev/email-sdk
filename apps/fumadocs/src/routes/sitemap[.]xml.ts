import { createFileRoute } from "@tanstack/react-router";

import { siteUrl } from "@/lib/shared";
import { getPageMarkdownUrl, source } from "@/lib/source";

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET() {
        const urls = [
          "/",
          "/docs",
          ...source.getPages().flatMap((page) => [page.url, getPageMarkdownUrl(page.slugs).url]),
        ];

        const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...new Set(urls)]
  .map(
    (url) => `  <url>
    <loc>${escapeXml(new URL(url, siteUrl).toString())}</loc>
  </url>`,
  )
  .join("\n")}
</urlset>`;

        return new Response(body, {
          headers: {
            "Content-Type": "application/xml; charset=utf-8",
          },
        });
      },
    },
  },
});

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
