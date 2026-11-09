import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { comparePairs } from "./compare";
import { permanentRedirects, securityHeaders, vercelRoutes, type VercelRoute } from "./vercel-routes";

const docsContent = join(import.meta.dirname, "../../content/docs");

function isRealPage(path: string) {
  if (path.startsWith("/compare/")) {
    return comparePairs.some((pair) => `/compare/${pair.slug}` === path);
  }

  const slug = path.replace(/^\/docs\/?/, "");

  return [`${slug}.mdx`, join(slug, "index.mdx")].some((file) => existsSync(join(docsContent, file)));
}

function matching(path: string, query: Record<string, string> = {}) {
  return vercelRoutes.filter(
    (route) =>
      new RegExp(route.src).test(path) &&
      (route.has ?? []).every((condition) => query[condition.key] === condition.value),
  );
}

/** Headers Vercel would send: every matching `continue` route, then the first final one. */
function resolve(path: string, query: Record<string, string> = {}) {
  const headers: Record<string, string> = {};
  let final: VercelRoute | undefined;

  for (const route of matching(path, query)) {
    Object.assign(headers, route.headers);

    if (!route.continue) {
      final = route;
      break;
    }
  }

  return { headers, final };
}

describe("vercel routes", () => {
  test("every source is a valid anchored regex", () => {
    for (const route of vercelRoutes) {
      expect(route.src.startsWith("^")).toBe(true);
      expect(route.src.endsWith("$")).toBe(true);
      expect(() => new RegExp(route.src)).not.toThrow();
    }
  });

  test.each(["/", "/docs", "/docs/adapters/resend", "/blog/some-post", "/index.md", "/llms.txt"])(
    "security headers apply to %s",
    (path) => {
      const { headers } = resolve(path);

      for (const [key, value] of Object.entries(securityHeaders)) {
        expect(headers[key]).toBe(value);
      }
    },
  );

  test("redirects old docs paths permanently, with or without a trailing slash", () => {
    for (const path of ["/docs/auth", "/docs/auth/"]) {
      const { final, headers } = resolve(path);
      expect(final?.status).toBe(308);
      expect(headers.Location).toBe("/docs/getting-started/credentials");
      expect(headers["X-Frame-Options"]).toBe("DENY");
    }

    expect(resolve("/docs/getting-started/credentials").final).toBeUndefined();
  });

  test.each(permanentRedirects.map(([from, to]) => [from, to]))(
    "%s redirects to a page that exists (%s)",
    (_from, to) => {
      expect(isRealPage(to)).toBe(true);
    },
  );

  test("the homepage keeps the discovery links next to its alternates", () => {
    const link = resolve("/").headers.Link;

    expect(link).toContain('rel="sitemap"');
    expect(link).toContain('rel="api-catalog"');
    expect(link).toContain('type="text/markdown"');
  });

  test("blog Markdown keeps its own short cache; other Markdown is cached for an hour", () => {
    expect(resolve("/blog/some-post.md").headers["Cache-Control"]).toBeUndefined();
    expect(resolve("/blog/some-post.md").headers["Content-Type"]).toBe("text/markdown; charset=utf-8");
    expect(resolve("/docs/quickstart.md").headers["Cache-Control"]).toContain("max-age=3600");
  });

  test("agent mode rewrites the homepage to the agent guide", () => {
    expect(resolve("/", { mode: "agent" }).final?.dest).toBe("/agents.md");
    expect(resolve("/").final).toBeUndefined();
  });

  test("markdown and feed content types", () => {
    expect(resolve("/docs/quickstart.md").headers["Content-Type"]).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(resolve("/feeds/docs.jsonl").headers["Content-Type"]).toBe(
      "application/x-ndjson; charset=utf-8",
    );
    expect(resolve("/.well-known/api-catalog").headers["Content-Type"]).toContain(
      "application/linkset+json",
    );
  });
});
