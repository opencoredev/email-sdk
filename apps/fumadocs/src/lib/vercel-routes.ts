/**
 * Response headers, redirects and the agent-mode rewrite for email-sdk.dev.
 *
 * The site deploys through Vercel's Build Output API (Nitro writes
 * `.vercel/output/config.json`), which ignores `headers`, `redirects` and
 * `rewrites` in `vercel.json`. These routes are merged into that generated
 * config through `nitro.vercel.config.routes` in `vite.config.ts`, ahead of
 * Nitro's own routes and the filesystem handler.
 *
 * Route `src` values are anchored regular expressions, not vercel.json
 * path patterns.
 */

type QueryCondition = {
  type: "query";
  key: string;
  value: string;
};

export type VercelRoute = {
  src: string;
  dest?: string;
  status?: number;
  headers?: Record<string, string>;
  has?: QueryCondition[];
  continue?: boolean;
};

// Google's favicon service (www.google.com/s2/favicons) redirects to
// t*.gstatic.com, and CSP checks the redirect target too.
const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://us-assets.i.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https://cdn.simpleicons.org https://www.google.com https://*.gstatic.com https://*.usenotra.com",
  "font-src 'self' data:",
  "connect-src 'self' https://vitals.vercel-insights.com https://*.vercel-insights.com https://us.i.posthog.com https://us-assets.i.posthog.com",
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

const discoveryLink =
  '</sitemap.xml>; rel="sitemap", </.well-known/api-catalog>; rel="api-catalog", </.well-known/agent.json>; rel="describedby"; type="application/json"';

const homeAlternatesLink =
  '</index.md>; rel="alternate"; type="text/markdown", </llms.txt>; rel="alternate"; type="text/plain"';

const revalidatingCache = "public, max-age=3600, stale-while-revalidate=86400";

const markdown = "text/markdown; charset=utf-8";

export const permanentRedirects: ReadonlyArray<readonly [from: string, to: string]> = [
  ["/docs/auth", "/docs/getting-started/credentials"],
  ["/docs/quickstart", "/docs/getting-started/quickstart"],
  ["/docs/install", "/docs/getting-started/install"],
  ["/docs/installation", "/docs/getting-started/install"],
  ["/docs/errors", "/docs/reference/errors"],
  ["/docs/cli", "/docs/reference/cli"],
  ["/docs/api", "/docs/reference/client"],
  ["/docs/providers", "/docs/adapters"],
  ["/docs/provider", "/docs/adapters"],
  ["/compare/postmark-vs-resend", "/compare/resend-vs-postmark"],
  ["/compare/sendgrid-vs-resend", "/compare/resend-vs-sendgrid"],
  ["/compare/ses-vs-resend", "/compare/resend-vs-ses"],
  ["/compare/mailgun-vs-resend", "/compare/resend-vs-mailgun"],
  ["/compare/loops-vs-resend", "/compare/resend-vs-loops"],
  ["/compare/mailersend-vs-resend", "/compare/resend-vs-mailersend"],
  ["/compare/sendgrid-vs-postmark", "/compare/postmark-vs-sendgrid"],
  ["/compare/mailgun-vs-postmark", "/compare/postmark-vs-mailgun"],
  ["/compare/ses-vs-postmark", "/compare/postmark-vs-ses"],
  ["/compare/mailgun-vs-sendgrid", "/compare/sendgrid-vs-mailgun"],
  ["/compare/ses-vs-sendgrid", "/compare/sendgrid-vs-ses"],
  ["/compare/brevo-vs-sendgrid", "/compare/sendgrid-vs-brevo"],
  ["/compare/ses-vs-mailgun", "/compare/mailgun-vs-ses"],
  ["/compare/mailersend-vs-brevo", "/compare/brevo-vs-mailersend"],
  ["/compare/mailtrap-vs-resend", "/compare/resend-vs-mailtrap"],
  ["/compare/ses-vs-mailersend", "/compare/mailersend-vs-ses"],
];

function exactPath(path: string) {
  return `^${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/?$`;
}

const agentMode: QueryCondition[] = [{ type: "query", key: "mode", value: "agent" }];

/** Header routes use `continue` so every matching rule adds its headers, in order. */
const headerRoutes: VercelRoute[] = [
  { src: "^/.*$", headers: { ...securityHeaders, Link: discoveryLink }, continue: true },
  // A later route's Link replaces the earlier one, so the homepage repeats the discovery links.
  { src: "^/$", headers: { Link: `${discoveryLink}, ${homeAlternatesLink}` }, continue: true },
  { src: "^/.*\\.md$", headers: { "Content-Type": markdown, Vary: "Accept-Encoding" }, continue: true },
  // Blog Markdown mirrors render on request from Notra and set their own short cache.
  { src: "^/(?!blog/).*\\.md$", headers: { "Cache-Control": revalidatingCache }, continue: true },
  { src: "^/.*\\.txt$", headers: { "Cache-Control": revalidatingCache }, continue: true },
  {
    src: exactPath("/feeds/docs.jsonl"),
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": revalidatingCache,
    },
    continue: true,
  },
  {
    src: exactPath("/.well-known/agent-skills"),
    headers: { "Content-Type": "application/json; charset=utf-8" },
    continue: true,
  },
  {
    src: exactPath("/.well-known/api-catalog"),
    headers: {
      "Content-Type": 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    },
    continue: true,
  },
];

const redirectRoutes: VercelRoute[] = permanentRedirects.map(([from, to]) => ({
  src: exactPath(from),
  status: 308,
  headers: { Location: to },
}));

/** `/?mode=agent` serves the agent guide instead of the homepage. */
const agentModeRoute: VercelRoute = {
  src: "^/$",
  has: agentMode,
  dest: "/agents.md",
  headers: { "Content-Type": markdown },
};

export const vercelRoutes: VercelRoute[] = [...headerRoutes, ...redirectRoutes, agentModeRoute];
