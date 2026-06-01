import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";

import { blogPosts, getBlogPostUrl } from "./src/lib/blog";
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

  return {
    server: {
      port: 3000,
    },
    define: {
      "import.meta.env.VITE_OG_IMAGE_VERSION": JSON.stringify(ogImageVersion),
    },
    plugins: [
      mdx(),
      tailwindcss(),
      tanstackStart({
        spa: {
          enabled: true,
          prerender: {
            enabled: true,
            crawlLinks: true,
          },
        },

        pages: [
          {
            path: "/docs",
          },
          {
            path: "/blog",
          },
          {
            path: "/privacy",
          },
          {
            path: "/terms",
          },
          ...blogPosts.map((post) => ({
            path: getBlogPostUrl(post.slug),
          })),
          ...versionedDocsPages,
          {
            path: "/api/search",
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
        ],
      }),
      react(),
      // please see https://tanstack.com/start/latest/docs/framework/react/guide/hosting#nitro for guides on hosting
      nitro(),
    ],
    resolve: {
      tsconfigPaths: true,
      alias: {
        tslib: "tslib/tslib.es6.js",
      },
    },
  };
});
