# fumadocs

This is a Tanstack Start application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
bun run dev
```

## Blog content

The blog combines source-controlled launch/editorial posts with [Notra](https://usenotra.com)
content. Notra API calls and credentials stay server-side, while local Markdown ships with
the site build:

| Path | Surface | Source | When it updates |
| --- | --- | --- | --- |
| **Source-controlled post** | `/blog`, `/blog/$slug`, OG, sitemap, feeds | `content/blog/*.md` + `src/lib/local-blog-posts.ts` | On deploy |
| **On-demand SSR** | `/blog`, `/blog/$slug` | Live fetch from Notra at request time | Within the edge-cache window (~60s), no rebuild |
| **On-demand SSR (OG images)** | `/og/blog/*` | Live fetch from Notra, rendered to SVG | No rebuild, but cached up to ~1 day (`max-age=86400`) |
| **Build-time snapshot** | `sitemap.xml`, `rss.xml`, `feed.json` | `src/lib/notra-posts.generated.ts`, written at build | On the next deploy |

Notra SSR picks up new posts without a rebuild, but its OG image SVGs cache far
longer than the blog pages (up to a day vs. ~60s), so a changed post title or
description can keep serving the old image for a while.

Everything else on the site (docs, home, marketing pages) is prerendered to
static HTML at build time.

### How it works

- **`src/lib/local-blog-posts.ts` + `src/lib/local-blog-runtime.ts`** — metadata
  and sanitized Markdown bodies for launch or editorial posts that need to ship in
  the same repository change as their images. Local posts take precedence on slug
  collisions and are merged with Notra for the blog index, post routes, OG images,
  sitemap, RSS, and JSON feed.

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

- **`src/routes/og/blog/$.ts`** — the SSR OG image route. It also loads from the
  runtime fetch, but the SVG response sets `Cache-Control: max-age=86400,
  stale-while-revalidate=604800`, so a regenerated image can take up to a day to
  replace a cached one.

- **`scripts/notra-content.ts`** — `mapNotraPost`, shared by both paths, maps a
  raw Notra post to the blog shape and renders its Markdown to sanitized HTML.

- **`vercel.json`** — deploys the full Build Output (`apps/fumadocs/.vercel/output`,
  not just `.../static`) so the Nitro SSR function ships alongside the prerendered
  static files. Prerendered routes are served from disk; blog routes hit the
  function.

### How a Notra post is mapped

Each published post is transformed by `mapNotraPost` in `scripts/notra-content.ts`
into the `BlogPost` shape (`src/lib/blog-types.ts`) plus a sanitized HTML body.
Both rendering paths share this mapping, so the rules below are the authoring
contract — what to expect when you write in Notra:

| Field | Source | Notes |
| --- | --- | --- |
| `slug` | always re-slugified | Even an explicit Notra slug is normalized (lowercased, ASCII, `-`-joined, max 80 chars). A value like `release/notes` would otherwise break the single-segment `/blog/$slug` route and the OG image path, so it is never used verbatim. Collisions get a `-2`, `-3`, … suffix. |
| `title` | post title (trimmed) | Required. A post with no usable title is skipped. |
| `description` | first paragraph of the body | ~155 chars, truncated at a word boundary. Falls back to `"<title> — notes from the Email SDK blog."` when no prose paragraph is found. |
| `publishedAt` | `createdAt` (date only) | `YYYY-MM-DD`, UTC. Drives ordering and feed visibility. |
| `updatedAt` | `updatedAt` (date only) | `YYYY-MM-DD`, UTC. |
| `readTime` | body word count | `N min read` at 200 wpm, minimum 1. |
| `image` / `imageAlt` | derived | `/og/blog/<slug>.svg` (generated OG image route) and `"<title> — Email SDK blog"`. |
| `tags` | — | Always empty; Notra tags are not carried over today. |

The body Markdown is rendered (GFM) and sanitized server-side — at request time
for the blog pages, at build time for the feed snapshot — so sanitized HTML is
what ships and nothing is sanitized in the browser. Author with this in mind:

- A single leading `# Title` is stripped — the page already renders the title,
  so a repeated H1 would show up twice.
- HTML is allowlisted (`sanitize-html`): images, headings, figures, tables,
  code, etc. are kept; scripts, iframes, and unknown tags/attributes are dropped.
- External links (`http(s)://…`) get `target="_blank"` + `rel="noopener noreferrer"`;
  images get `loading="lazy"` + `decoding="async"`.
- Allowed URL schemes are `http`, `https`, `mailto` (plus `data:` for `<img>`).

### Visibility rules

- **Drafts never appear** — both paths request `status: "published"` from Notra,
  and `mapNotraPost` skips anything else as a second guard.
- **Future-dated posts** (a `publishedAt` after today) show up on the SSR blog
  as soon as Notra returns them; only the snapshot consumers (`sitemap.xml`,
  `rss.xml`, `feed.json`) hold them back until their date, via
  `isBlogPostPublished` in `src/lib/blog.ts`.
- An empty body renders a "This post does not have any content yet." placeholder;
  with no published posts at all, the index shows a "No posts yet" empty state.

### Post images and CSP

Images embedded in post bodies are served from Notra's CDN. The site's
Content-Security-Policy (root `vercel.json`) allows `https://*.usenotra.com`
under `img-src`. If post images ever move to a different host, add it there or
they will be blocked in the browser.

### Environment

Set `NOTRA_API_KEY` — it is now needed at **both build time and runtime**:

- Local: `apps/fumadocs/.env.local` (gitignored).
- Production: add `NOTRA_API_KEY` to the Vercel project's environment variables
  so the deployed SSR function can reach Notra, **and** keep it listed in
  `passThroughEnv` in `apps/fumadocs/turbo.json`. Turbo runs in strict env mode
  and strips any variable the build task does not declare, so without that entry
  the build-time feed fetch (`scripts/fetch-notra-posts.ts`) never sees the key
  even when Vercel has it. Only the build path needs the pass-through; the
  deployed SSR function reads the Vercel env directly.

Without the key the runtime fetch returns an empty blog (the page still renders),
and the build-time fetch is skipped so the last committed snapshot is kept — the
build never fails.

### Publishing cadence

Source-controlled posts require a deploy and appear in the blog, sitemap, and feeds
from that same build. New and updated Notra posts appear on the live blog pages within the edge-cache window
(~60s) with no rebuild. OG images (`/og/blog/*`) also update without a rebuild
but cache for up to a day, so a changed title or description can keep serving the
old SVG for a while. A rebuild is only needed to refresh the sitemap/RSS/feed
snapshot — the `Refresh blog posts from Notra` GitHub workflow triggers a weekly
Vercel rebuild, and you can point a Notra publish webhook at the same Vercel
deploy hook to refresh those feeds sooner.
