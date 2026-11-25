import { describe, expect, test } from "bun:test";

import {
  dateCustomPages,
  markdownContentTypeRoute,
  type ParsedRoute,
  patchVercelRoutes,
  trimArchivedLlms,
} from "./vercel-config-patch";
import { agentModeRoute, headerRoutes } from "./vercel-headers";

// A trimmed copy of the routes `blume build` writes: a generated header route,
// the filesystem handler, and a Markdown rewrite after it.
const generatedRoutes: ParsedRoute[] = [
  { src: "^/$", headers: { Link: '</llms.txt>; rel="llms-txt"' }, continue: true },
  { handle: "filesystem" },
  { src: "^/docs/(.*)\\.md$", dest: "/docs/$1.md" },
  { src: "^/index\\.md$", dest: "/index.md", headers: { "x-markdown-tokens": "9999" } },
];

function changedRoutes(routes: readonly ParsedRoute[], indexTokenCount?: string) {
  const patch = patchVercelRoutes({ routes, indexTokenCount });

  if (patch.kind !== "changed") throw new Error("expected the patch to change the routes");

  return patch.routes;
}

describe("patchVercelRoutes", () => {
  test("puts the site routes ahead of the generated routes", () => {
    const routes = changedRoutes(generatedRoutes);
    const filesystemIndex = routes.findIndex((route) => route.handle === "filesystem");

    for (const siteRoute of [...headerRoutes, markdownContentTypeRoute, agentModeRoute]) {
      const index = routes.findIndex(
        (route) => JSON.stringify(route) === JSON.stringify(siteRoute),
      );

      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(filesystemIndex);
    }
  });

  test("serves .md routes as text/markdown", () => {
    const contentTypes = changedRoutes(generatedRoutes)
      .filter((entry) => entry.src === "^/.*\\.md$")
      .map((entry) => entry.headers?.["Content-Type"]);

    expect(contentTypes).toContain("text/markdown; charset=utf-8");
  });

  test("keeps every generated route in its original order", () => {
    const routes = changedRoutes(generatedRoutes);
    const generated = routes.slice(routes.length - generatedRoutes.length);

    expect(generated.map((route) => route.handle ?? route.src)).toEqual(
      generatedRoutes.map((route) => route.handle ?? route.src),
    );
  });

  test("merges the homepage Link header instead of adding a second route", () => {
    const homeRoutes = changedRoutes(generatedRoutes).filter(
      (route) => route.src === "^/$" && route.headers?.Link !== undefined,
    );

    expect(homeRoutes).toHaveLength(1);
    expect(homeRoutes[0]?.headers?.Link).toContain('rel="llms-txt"');
    expect(homeRoutes[0]?.headers?.Link?.split('rel="llms-txt"').length).toBe(2);
    expect(homeRoutes[0]?.headers?.Link).toContain('</index.md>; rel="alternate"');
  });

  test("syncs the curated index.md token count", () => {
    const route = changedRoutes(generatedRoutes, "512").find((entry) => entry.dest === "/index.md");

    expect(route?.headers?.["x-markdown-tokens"]).toBe("512");
  });

  test("changes nothing on a second run", () => {
    const once = changedRoutes(generatedRoutes, "512");

    expect(patchVercelRoutes({ routes: once, indexTokenCount: "512" })).toEqual({
      kind: "unchanged",
    });
  });

  test("refuses a config without a filesystem handler", () => {
    expect(() => patchVercelRoutes({ routes: [{ src: "^/$" }] })).toThrow("filesystem handler");
  });
});

describe("trimArchivedLlms", () => {
  const llms = [
    "# Email SDK",
    "",
    "## Docs",
    "",
    "- [Quickstart](https://email-sdk.dev/docs/getting-started/quickstart)",
    "",
    "## v3.0.0 (archived)",
    "",
    "- [Old page](https://email-sdk.dev/v3.0.0/docs/old)",
    "",
    "## v2.0.0 (archived)",
    "",
    "- [Older page](https://email-sdk.dev/v2.0.0/docs/old)",
    "",
    "## Blog",
    "",
    "- [Post](https://email-sdk.dev/blog/post)",
    "",
  ].join("\n");

  test("replaces the archived sections with one list and keeps later sections", () => {
    const trimmed = trimArchivedLlms(llms, ["v3.0.0", "v2.0.0"]);

    expect(trimmed).toContain("## Archived versions");
    expect(trimmed).toContain(
      "- [v3.0.0](https://email-sdk.dev/v3.0.0/docs): archived documentation",
    );
    expect(trimmed).not.toContain("Old page");
    expect(trimmed).toContain("## Blog");
    expect(trimmed).toContain("## Docs");
  });

  test("is a no-op once trimmed", () => {
    const trimmed = trimArchivedLlms(llms, ["v3.0.0", "v2.0.0"]);

    expect(trimArchivedLlms(trimmed, ["v3.0.0", "v2.0.0"])).toBe(trimmed);
  });
});

describe("dateCustomPages", () => {
  const sitemap = [
    "<urlset>",
    "  <url><loc>https://email-sdk.dev/</loc></url>",
    "  <url><loc>https://email-sdk.dev/about</loc><lastmod>2026-09-26</lastmod></url>",
    "  <url><loc>https://email-sdk.dev/blog</loc></url>",
    "  <url><loc>https://email-sdk.dev/blog/a</loc><lastmod>2026-11-17</lastmod></url>",
    "  <url><loc>https://email-sdk.dev/blog/b</loc><lastmod>2026-11-23</lastmod></url>",
    "  <url><loc>https://email-sdk.dev/stats</loc></url>",
    "</urlset>",
  ].join("\n");

  test("dates the homepage and the blog index, and nothing else", () => {
    const dated = dateCustomPages(sitemap, "2026-11-22", "2026-11-01");

    expect(dated).toContain("<loc>https://email-sdk.dev/</loc><lastmod>2026-11-22</lastmod>");
    expect(dated).toContain("<loc>https://email-sdk.dev/blog</loc><lastmod>2026-11-23</lastmod>");
    expect(dated).toContain("<url><loc>https://email-sdk.dev/stats</loc></url>");
    expect(dated).toContain("<loc>https://email-sdk.dev/about</loc><lastmod>2026-09-26</lastmod>");
  });

  test("dates the blog index by its own change when that is newer than every post", () => {
    expect(dateCustomPages(sitemap, undefined, "2026-11-25")).toContain(
      "<loc>https://email-sdk.dev/blog</loc><lastmod>2026-11-25</lastmod>",
    );
  });

  test("leaves the homepage undated without a date", () => {
    expect(dateCustomPages(sitemap, undefined, undefined)).toContain(
      "<url><loc>https://email-sdk.dev/</loc></url>",
    );
  });
});
