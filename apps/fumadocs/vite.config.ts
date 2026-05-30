import { readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

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

export default defineConfig({
  server: {
    port: 3000,
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
        ...versionedDocsPages,
        {
          path: "/api/search",
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
});
