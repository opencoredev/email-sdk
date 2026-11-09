import { describe, expect, test } from "bun:test";

import { securityHeaders, vercelRoutes, type VercelRoute } from "./vercel-routes";

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
      expect(headers.Location).toBe("/docs/authentication");
      expect(headers["X-Frame-Options"]).toBe("DENY");
    }

    expect(resolve("/docs/authentication").final).toBeUndefined();
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
