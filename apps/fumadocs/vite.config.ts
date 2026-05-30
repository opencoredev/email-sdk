import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import mdx from "fumadocs-mdx/vite";
import { nitro } from "nitro/vite";
import { defineConfig, loadEnv } from "vite";

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
  };
});
