import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";

import { comparePairs } from "./src/lib/compare";
import { docsVersions, getDocsVersionHref } from "./src/lib/versions";

function collectContentPages(dir: string) {
  const pages: string[] = [];

  function walk(currentDir: string) {
    for (const entry of readdirSync(currentDir)) {
      const fullPath = join(currentDir, entry);
      const stat = statSync(fullPath);

      if (stat.isDirectory()) {
        walk(fullPath);
        continue;
      }

      if (!entry.endsWith(".mdx")) continue;

      const pagePath = relative(dir, fullPath)
        .replace(/\.mdx$/, "")
        .split(sep)
        .filter((part) => part !== "index")
        .join("/");

      pages.push(pagePath ? `/docs/${pagePath}` : "/docs");
    }
  }

  walk(dir);

  return pages;
}

const versionedDocsPages = docsVersions.flatMap((version) => {
  if (version.current) return [];

  const contentDir = join(import.meta.dirname, version.contentPath);
  const pages = collectContentPages(contentDir);

  return pages.map((path) => ({
    path: getDocsVersionHref(version, path),
  }));
});

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const ogImageVersion =
    env.VITE_OG_IMAGE_VERSION ||
    env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
    new Date().toISOString().slice(0, 10).replaceAll("-", "");
  const buildId = env.VITE_EMAIL_SDK_BUILD_ID || env.VERCEL_GIT_COMMIT_SHA || ogImageVersion;

  return {
    server: {
      port: 3000,
    },
    define: {
      "import.meta.env.VITE_OG_IMAGE_VERSION": JSON.stringify(ogImageVersion),
      "import.meta.env.VITE_EMAIL_SDK_BUILD_ID": JSON.stringify(buildId),
    },
    plugins: [
      mdx(),
      tailwindcss(),
      tanstackStart({
        // Full static prerendering (SSG), not SPA mode. SPA mode reserves "/" for the
        // pending-fallback shell and ships an empty <body> at the root — invisible to AI
        // crawlers and search engines. Top-level prerender renders every route, including
        // the homepage, to static HTML with real content; the client still hydrates for
        // interactivity (provider switcher, search, theme toggle).
        prerender: {
          enabled: true,
          crawlLinks: true,
          // Blog routes (/blog, /blog/$slug, /og/blog/*) render on-demand via the
          // SSR function so new Notra posts appear without a rebuild, and /stats
          // renders on-demand so its npm/GitHub numbers stay fresh; everything
          // else stays prerendered to static HTML.
          filter: ({ path }: { path: string }) =>
            !path.startsWith("/blog") && !path.startsWith("/og/blog") && path !== "/stats",
        },

        pages: [
          {
            path: "/",
          },
          {
            path: "/docs",
          },
          {
            path: "/about",
          },
          {
            path: "/contact",
          },
          {
            path: "/privacy",
          },
          {
            path: "/terms",
          },
          ...versionedDocsPages,
          {
            path: "/compare",
          },
          ...comparePairs.map((pair) => ({ path: `/compare/${pair.slug}` })),
          {
            path: "/tools",
          },
          {
            path: "/tools/email-dns-checker",
          },
          {
            path: "/api/search",
          },
          {
            path: "/api/build-info",
          },
          {
            path: "sitemap.xml",
          },
          {
            path: "rss.xml",
          },
          {
            path: "feed.json",
          },
          {
            path: "llms-full.txt",
          },
          {
            path: "llms.txt",
          },
          {
            path: "llms.md",
          },
          {
            path: "index.md",
          },
          {
            path: "/docs/llms.txt",
          },
          {
            path: "/feeds/docs.jsonl",
          },
        ],
      }),
      react(),
      // please see https://tanstack.com/start/latest/docs/framework/react/guide/hosting#nitro for guides on hosting
      nitro(),
    ],
    resolve: {
      tsconfigPaths: true,
      // Force tslib's ESM build, but via the explicit `.mjs` file: `tslib.es6.js`
      // is `.js` inside a CommonJS-default package, so the bundler reads it as CJS
      // and misses named helpers like __spreadArray. Exact-match the bare specifier
      // so the alias can't re-apply to its own output (tslib/tslib.es6.mjs/...).
      alias: [{ find: /^tslib$/, replacement: "tslib/tslib.es6.mjs" }],
    },
  };
});
