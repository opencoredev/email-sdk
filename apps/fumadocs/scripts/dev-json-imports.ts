import type { Plugin } from "vite";

const JSON_MODULE_PATHS = new Set([
  "/content/community/plugins.json",
  "/src/lib/docs-lastmod.generated.json",
  "/src/lib/field-support.generated.json",
]);

export function devJsonImports(): Plugin {
  return {
    name: "docs-dev-json-imports",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        // Chromium-based embedded browsers send `Sec-Fetch-Dest: empty` for
        // module-graph imports; Nitro then routes the JSON to the page handler.
        const destination = req.headers["sec-fetch-dest"];
        if (req.method !== "GET" || (destination !== undefined && destination !== "empty")) {
          return next();
        }

        try {
          const rawUrl = req.url ?? "";
          if (!rawUrl.startsWith("/") || rawUrl.startsWith("//")) return next();
          const queryIndex = rawUrl.indexOf("?");
          if (queryIndex === -1) return next();
          const pathname = decodeURI(rawUrl.slice(0, queryIndex));
          const query = new URLSearchParams(rawUrl.slice(queryIndex + 1));
          if (JSON_MODULE_PATHS.has(pathname) && query.get("import") === "") {
            // Nitro omits JSON from its HTTP asset fallback; retain Vite's pipeline.
            req.headers["sec-fetch-dest"] = "script";
          }
        } catch {
          // Vite's normal request handler owns malformed URL responses.
        }
        next();
      });
    },
  };
}
