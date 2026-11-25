import { defineConfig } from "blume";
import { posthog, vercel as vercelAnalytics } from "blume/analytics";
import { vercel } from "blume/deploy";

import { markdownComponents } from "./lib/markdown-components";
import { latestDocsRedirects, permanentRedirects } from "./lib/redirects";
import { appDescription, llmsOverview } from "./lib/shared";
import { siteOrganization } from "./lib/structured-data";
import {
  archivedDocsVersions,
  currentDocsLabel,
  docsVersion,
  legacyArchivedVersionHref,
} from "./lib/versions";
import { emailSdkDark, emailSdkLight } from "./themes/code";

type Redirect = NonNullable<Parameters<typeof defineConfig>[0]["redirects"]>[number];

// The Fumadocs site served each archive at /docs/v/<release>/... (and /docs/v/<release>.md);
// Blume serves it at /<id>/docs/... (an archived version's id must start with a letter).
const archiveRedirects: Redirect[] = archivedDocsVersions.flatMap((version): Redirect[] => [
  {
    from: `${legacyArchivedVersionHref(version)}.md`,
    to: `/${version.id}/docs.md`,
    status: 308,
  },
  {
    from: `${legacyArchivedVersionHref(version)}/index.md`,
    to: `/${version.id}/docs.md`,
    status: 308,
  },
  {
    from: `/${version.id}/docs/index.md`,
    to: `/${version.id}/docs.md`,
    status: 308,
  },
  {
    from: `${legacyArchivedVersionHref(version)}/:path*`,
    to: `/${version.id}/docs/:path*`,
    status: 308,
  },
]);

// Legacy directory-index Markdown URLs that Fumadocs served at /.../index.md.
const docsIndexMdRedirects: Redirect[] = [
  "/docs",
  "/docs/adapters",
  "/docs/agents",
  "/docs/integrations/convex",
  "/docs/plugins",
  "/docs/reference/cli",
  "/docs/reference/errors",
  "/docs/ui",
].map((base): Redirect => ({
  from: `${base}/index.md`,
  to: `${base}.md`,
  status: 308,
}));

// An archive has no page at its bare /<id> (its pages start at /<id>/docs),
// which is where the version switcher lands from a page outside the docs.
const archiveRootRedirects = archivedDocsVersions.map((version): Redirect => ({
  from: `/${version.id}`,
  to: `/${version.id}/docs`,
  status: 308,
}));

const docsRedirects = Object.entries(latestDocsRedirects).map(([from, to]): Redirect => ({
  from: `/docs/${from}`,
  to: `/docs/${to}`,
  status: 308,
}));

const siteRedirects = permanentRedirects.map(([from, to]): Redirect => ({ from, to, status: 308 }));

// Machine-readable URLs the Fumadocs site served under other names. Blume
// generates the same documents at its own paths.
const machineRedirects: Redirect[] = [
  { from: "/rss.xml", to: "/blog/rss.xml", status: 308 },
  { from: "/llms.md", to: "/llms.txt", status: 308 },
  { from: "/docs/llms.txt", to: "/llms.txt", status: 308 },
  { from: "/.well-known/agent-skills", to: "/.well-known/agent-skills/index.json", status: 308 },
];

export default defineConfig({
  title: "Email SDK",
  description: appDescription,
  // Text only, like the Fumadocs header: the favicon mark spells the name too.
  logo: { text: "Email SDK" },

  content: {
    root: "content",
  },

  github: {
    owner: "opencoredev",
    repo: "email-sdk",
    dir: "apps/docs",
  },

  theme: {
    // The landing page's warm near-black ink, parchment text, and one gold
    // accent. The full palette lives in theme.css.
    mode: "system",
    radius: "none",
    accent: { light: "#7f6410", dark: "#c9a227" },
    background: { light: "#f4f1e8", dark: "#090906" },
    fonts: {
      display: "inter",
      body: "inter",
      mono: "jetbrains-mono",
    },
  },

  markdown: {
    code: {
      theme: { light: emailSdkLight, dark: emailSdkDark },
    },
  },

  navigation: {
    sidebar: { display: "group" },
    // The Fumadocs header's main links, as tabs that scope the sidebar.
    tabs: [
      { label: "Docs", path: "/docs", icon: "book-open" },
      { label: "Blog", path: "/blog", icon: "newspaper" },
      { label: "Compare", path: "/compare", icon: "git-compare-arrows" },
      { label: "Tools", path: "/tools", icon: "wrench" },
    ],
    actions: [{ label: "Stats", href: "/stats" }],
    cta: { label: "Get started", href: "/docs/getting-started/quickstart" },
  },

  versions: {
    current: { label: currentDocsLabel, badge: docsVersion },
    // The Fumadocs archive sent `X-Robots-Tag: noindex` on every old page;
    // keep them out of search the same way.
    archived: archivedDocsVersions.map((version) => ({
      id: version.id,
      label: version.id,
      noindex: true,
    })),
  },

  search: {
    popular: [
      { href: "/docs/getting-started/quickstart", label: "Quickstart", icon: "rocket" },
      { href: "/docs/adapters", label: "Adapters", icon: "at-sign" },
      { href: "/docs/adapters/field-support", label: "Field support" },
      { href: "/docs/concepts/fallbacks-and-retries", label: "Fallbacks and retries" },
      { href: "/docs/reference/errors", label: "Errors" },
      { href: "/docs/reference/cli", label: "CLI" },
    ],
  },

  agents: {
    llmsTxt: { details: llmsOverview },
    // Search and read these docs from an agent:
    // claude mcp add --transport http email-sdk https://email-sdk.dev/mcp
    mcp: { enabled: true },
    // The repo's agent skills (skills/*/SKILL.md), published at
    // /.well-known/agent-skills/.
    skills: "../../skills",
    markdownComponents,
  },

  lastModified: "git",

  seo: {
    // public/robots.txt carries the hand-written crawler policy.
    robots: false,
    og: { enabled: true },
    organization: siteOrganization,
    software: {
      name: "Email SDK",
      license: "https://github.com/opencoredev/email-sdk/blob/main/LICENSE",
      operatingSystem: "Node.js 20+, Bun 1.1+",
      price: 0,
      sameAs: [
        "https://www.npmjs.com/package/@opencoredev/email-sdk",
        "https://github.com/opencoredev/email-sdk",
      ],
    },
  },

  // The same PostHog project and settings the Fumadocs site initialized
  // (write-only public key). Blume loads analytics in production builds only.
  analytics: [
    posthog({
      key: "phc_D62r4m5ivBr6LPCBqjKHg8GL6QTxT57LTzKrmkg5hNZS",
      host: "https://us.i.posthog.com",
      defaults: "2026-01-30",
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false,
      },
      capture_performance: { web_vitals: true },
      person_profiles: "identified_only",
      disable_session_recording: true,
    }),
    vercelAnalytics(),
  ],

  // Server output on Vercel, so /mcp runs and every page answers
  // `Accept: text/markdown` at its own URL.
  deployment: vercel({ site: "https://email-sdk.dev" }),

  redirects: [
    ...archiveRedirects,
    ...archiveRootRedirects,
    ...docsIndexMdRedirects,
    ...docsRedirects,
    ...siteRedirects,
    ...machineRedirects,
  ],

  feedback: false,
});
