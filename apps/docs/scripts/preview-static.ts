import { existsSync, readFileSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

import { z } from "zod";

const docsRoot = resolve(import.meta.dir, "..");

const staticDir = join(docsRoot, ".vercel/output/static");

const vercelConfigPath = join(docsRoot, ".vercel/output/config.json");

if (!existsSync(staticDir)) {
  console.error("Missing .vercel/output/static. Run `bun run build` first.");
  process.exit(1);
}

const args = process.argv.slice(2);

let host = "127.0.0.1";

let port = 4321;

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i];

  if (arg === "--host" && args[i + 1]) {
    host = args[i + 1] ?? host;
    i += 1;
  } else if (arg?.startsWith("--host=")) {
    host = arg.slice("--host=".length);
  } else if (arg === "--port" && args[i + 1]) {
    port = Number(args[i + 1]);
    i += 1;
  } else if (arg?.startsWith("--port=")) {
    port = Number(arg.slice("--port=".length));
  }
}

type RedirectRule = {
  regex: RegExp;
  location: string;
  status: number;
};

const vercelRedirectRouteSchema = z.object({
  src: z.string(),
  status: z.number().int().min(300).max(399),
  headers: z.object({ Location: z.string() }),
});

const vercelConfigSchema = z.object({
  routes: z.array(z.unknown()).optional(),
});

function loadRedirectRoutes(): RedirectRule[] {
  if (!existsSync(vercelConfigPath)) return [];

  try {
    const parsed = vercelConfigSchema.safeParse(JSON.parse(readFileSync(vercelConfigPath, "utf8")));

    if (!parsed.success || !parsed.data.routes) return [];

    const rules: RedirectRule[] = [];

    for (const entry of parsed.data.routes) {
      const route = vercelRedirectRouteSchema.safeParse(entry);

      if (!route.success) continue;

      rules.push({
        regex: new RegExp(route.data.src),
        location: route.data.headers.Location,
        status: route.data.status,
      });
    }

    return rules;
  } catch {
    return [];
  }
}

const redirectRoutes = loadRedirectRoutes();

const mimeTypes = new Map<string, string>([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".jsonl", "application/x-ndjson; charset=utf-8"],
  [".md", "text/markdown; charset=utf-8"],
  [".txt", "text/plain; charset=utf-8"],
  [".xml", "application/xml; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".jpg", "image/jpeg"],
  [".jpeg", "image/jpeg"],
  [".webp", "image/webp"],
  [".ico", "image/x-icon"],
  [".woff2", "font/woff2"],
  [".woff", "font/woff"],
  [".wasm", "application/wasm"],
]);

function resolveStaticFile(pathname: string): string | null {
  const decoded = decodeURIComponent(pathname);

  const safePath = normalize(decoded).replace(/^(\.\.(\/|\\|$))+/, "");

  const candidates = safePath.endsWith("/")
    ? [join(staticDir, safePath, "index.html")]
    : [
        join(staticDir, safePath),
        join(staticDir, safePath, "index.html"),
        join(staticDir, `${safePath}.html`),
      ];

  for (const candidate of candidates) {
    if (!candidate.startsWith(staticDir)) continue;

    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

const server = Bun.serve({
  hostname: host,
  port,
  fetch(req) {
    const url = new URL(req.url);

    const pathname = url.pathname;

    const directFile = resolveStaticFile(pathname);

    if (directFile) {
      const contentType =
        mimeTypes.get(extname(directFile).toLowerCase()) ?? "application/octet-stream";

      return new Response(Bun.file(directFile), {
        status: 200,
        headers: { "content-type": contentType },
      });
    }

    for (const route of redirectRoutes) {
      const match = route.regex.exec(pathname);

      if (match) {
        const location = route.location.replace(/\$(\d+)/g, (_, idx) => match[Number(idx)] ?? "");

        return new Response(null, {
          status: route.status,
          headers: { location },
        });
      }
    }

    const notFound = join(staticDir, "404.html");

    if (existsSync(notFound)) {
      return new Response(Bun.file(notFound), {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }

    return new Response("Not Found", { status: 404 });
  },
});

console.log(`Static preview serving .vercel/output/static at http://${server.hostname}:${server.port}`);
