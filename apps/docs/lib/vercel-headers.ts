/**
 * Response headers and the agent-mode rewrite for email-sdk.dev, carried over
 * from the Fumadocs site. Blume's vercel() build writes
 * .vercel/output/config.json (Build Output API), which ignores `headers` in
 * vercel.json, so scripts/patch-vercel-config.ts splices these routes into
 * that file after `blume build`. Route `src` values are anchored regular
 * expressions, not vercel.json path patterns.
 */

type QueryCondition = { type: "query"; key: string; value: string };

export type VercelRoute = {
  src: string;
  dest?: string;
  status?: number;
  headers?: Record<string, string>;
  has?: QueryCondition[];
  continue?: boolean;
};

// Google's favicon service redirects to t*.gstatic.com, and CSP checks the
// redirect target too. The DNS checker and the stats page query
// DNS-over-HTTPS and the npm registry from the browser.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://us-assets.i.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://cdn.simpleicons.org https://www.google.com https://*.gstatic.com https://*.usenotra.com",
  "font-src 'self' data:",
  "connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com https://cloudflare-dns.com https://dns.google https://api.npmjs.org",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
].join("; ");

export const securityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Content-Security-Policy": contentSecurityPolicy,
} satisfies Record<string, string>;

export const discoveryLink =
  '</sitemap.xml>; rel="sitemap", </.well-known/api-catalog>; rel="api-catalog", </.well-known/agent.json>; rel="describedby"; type="application/json"';

export const homeAlternatesLink =
  '</index.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel="alternate"; type="text/plain"';

const revalidatingCache = "public, max-age=3600, stale-while-revalidate=86400";

/** Added at the top: every response gets the security and discovery headers. */
export const headerRoutes: VercelRoute[] = [
  { src: "^/.*$", headers: { ...securityHeaders, Link: discoveryLink }, continue: true },
  { src: "^/.*\\.md$", headers: { "Cache-Control": revalidatingCache }, continue: true },
  { src: "^/.*\\.txt$", headers: { "Cache-Control": revalidatingCache }, continue: true },
  {
    src: "^/feeds/docs\\.jsonl$",
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": revalidatingCache,
    },
    continue: true,
  },
  {
    src: "^/feed\\.json$",
    headers: { "Content-Type": "application/feed+json; charset=utf-8" },
    continue: true,
  },
  {
    src: "^/\\.well-known/agent-skills/?$",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    continue: true,
  },
  {
    src: "^/\\.well-known/api-catalog/?$",
    headers: {
      "Content-Type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    },
    continue: true,
  },
  {
    src: "^/v\\d+\\.\\d+\\.\\d+(?:/.*)?$",
    headers: { "X-Robots-Tag": "noindex, follow" },
    continue: true,
  },
];

/** Added before the filesystem handler: `/?mode=agent` serves the agent guide. */
export const agentModeRoute: VercelRoute = {
  src: "^/$",
  has: [{ type: "query", key: "mode", value: "agent" }],
  dest: "/agents.md",
  headers: { "Content-Type": "text/markdown; charset=utf-8" },
};
