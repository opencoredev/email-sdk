# fumadocs

This is a Tanstack Start application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
bun run dev
```

## Blog content (Notra)

The blog is powered by [Notra](https://usenotra.com). The site uses **two
rendering paths** for Notra content, both reading the API key server-side only —
no Notra calls ever happen from the browser:

| Path | Surface | Source | When it updates |
| --- | --- | --- | --- |
| **On-demand SSR** | `/blog`, `/blog/$slug`, and OG images `/og/blog/*` | Live fetch from Notra at request time | Within the edge-cache window (~60s), no rebuild |
| **Build-time snapshot** | `sitemap.xml`, `rss.xml`, `feed.json` | `src/lib/notra-posts.generated.ts`, written at build | On the next deploy |

Everything else on the site (docs, home, marketing pages) is prerendered to
static HTML at build time.

### How it works

- **`src/lib/notra-runtime.ts`** — server functions (`getBlogPostsServerFn`,
  `getBlogPostServerFn`) that fetch published posts from Notra at request time.
  The blog routes are excluded from prerendering (`prerender.filter` in
  `vite.config.ts`), so they run inside the Vercel SSR function and pick up new
  posts without a rebuild. `@usenotra/sdk` and the Markdown renderer are
  dynamically imported so they stay out of the client bundle. Responses are
  edge-cached with `Cache-Control: s-maxage=60, stale-while-revalidate=600`, so
  Notra is hit at most once per cache window.

- **`scripts/fetch-notra-posts.ts`** — build-time fetch that writes the
  `notra-posts.generated.ts` snapshot. This snapshot now backs only the
  sitemap/RSS/JSON feeds (see `src/lib/blog.ts`). It runs automatically before
  `vite build`, or on demand:

  ```bash
  bun run posts:fetch
  ```

- **`scripts/notra-content.ts`** — `mapNotraPost`, shared by both paths, maps a
  raw Notra post to the blog shape and renders its Markdown to sanitized HTML.

- **`vercel.json`** — deploys the full Build Output (`apps/fumadocs/.vercel/output`,
  not just `.../static`) so the Nitro SSR function ships alongside the prerendered
  static files. Prerendered routes are served from disk; blog routes hit the
  function.

### Environment

Set `NOTRA_API_KEY` — it is now needed at **both build time and runtime**:

- Local: `apps/fumadocs/.env.local` (gitignored).
- Production: add `NOTRA_API_KEY` to the Vercel project's environment variables
  so the deployed SSR function can reach Notra.

Without the key the runtime fetch returns an empty blog (the page still renders),
and the build-time fetch is skipped so the last committed snapshot is kept — the
build never fails.

### Publishing cadence

New and updated posts appear on the live blog within the edge-cache window
(~60s) with no rebuild. A rebuild is only needed to refresh the
sitemap/RSS/feed snapshot — the `Refresh blog posts from Notra` GitHub workflow
triggers a weekly Vercel rebuild, and you can point a Notra publish webhook at
the same Vercel deploy hook to refresh those feeds sooner.
