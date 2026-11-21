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

/** Added at the top: every response gets the security headers. */
export const headerRoutes: VercelRoute[] = [
  { src: "^/.*$", headers: { ...securityHeaders }, continue: true },
  {
    src: "^/feeds/docs\\.jsonl$",
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8" },
    continue: true,
  },
  {
    src: "^/feed\\.json$",
    headers: { "Content-Type": "application/feed+json; charset=utf-8" },
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
