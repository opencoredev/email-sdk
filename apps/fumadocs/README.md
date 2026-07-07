# fumadocs

This is a Tanstack Start application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
bun run dev
```

## Build pipeline

`bun run build` is not a bare `vite build` — it wraps the build in two dependency
guards plus the Notra snapshot fetch and a static-index fixup. The steps run in
order and any non-zero step fails the build:

| Step | Script | Purpose |
| --- | --- | --- |
| 1. Identity guard (pre-build) | `scripts/check-module-identity.ts` | Fails if singleton-critical packages resolve to two different installs (see below). |
| 2. Blog snapshot | `scripts/fetch-notra-posts.ts` | Writes `src/lib/notra-posts.generated.ts` for the sitemap/RSS/feed (see [Blog content](#blog-content-notra)). |
| 3. Vite build | `vite build` | Prerenders the site and builds the client bundle + Nitro SSR function. |
| 4. Bundle backstop (post-build) | `scripts/check-client-bundle.ts` | Fails if the fumadocs framework-context module lands in more than one client chunk. |
| 5. Static index | `scripts/ensure-root-index.ts` | Copies `_shell.html` to `index.html` in each output root when the build didn't emit one. |

To validate docs-site changes locally, run `bun run types:check` and `bun run
build`. In CI the same build runs through `release:ci` (`turbo build`) against
the **frozen lockfile**, so a dependency split that only reproduces on a clean
install is caught there.

### Why the dependency guards exist

Fumadocs holds React contexts (most visibly the one behind `RootProvider`) at
module scope. If the app and `fumadocs-ui` resolve **two physical copies** of
`fumadocs-core`, there are two context instances: `RootProvider` writes to one
while page components read the other, and every page crashes at hydration with
**"You need to wrap your application inside `FrameworkProvider`"**. Crucially the
build stays green — this is a runtime-only failure — so without an explicit
check the crash ships. This took production down on 2026-07-07 when a deps
refresh bumped only the app's `lucide-react` to `1.23.0`: `lucide-react` is a
peer dependency of `fumadocs-core`, so the version split made bun's isolated
linker materialize `fumadocs-core` once per peer set.

**`scripts/check-module-identity.ts`** (pre-build) resolves each
singleton-critical package from both the app and from `fumadocs-ui` and fails if
they differ. The guarded packages are `fumadocs-core`, `react`, `react-dom`,
`@tanstack/react-router`, and `lucide-react` (checked explicitly because it is
the usual trigger for a `fumadocs-core` split). On a split it prints both
resolved paths; fix it by aligning the versions in `apps/fumadocs/package.json`
with what `fumadocs-ui` resolves — **when bumping `lucide-react` or any fumadocs
package, bump them together** — or re-resolve so bun unifies them, then re-run
the build to confirm.

**`scripts/check-client-bundle.ts`** (post-build) is a backstop for the case the
identity check can't see: the bundler duplicating the module graph even from a
single install. It scans the built client chunks and fails if the framework
context (identified by the `FrameworkProvider` marker string) appears in more
than one `.js` chunk. It reads whichever of `.vercel/output/static/assets` or
`.output/public/assets` was written most recently, or an explicit directory:

```bash
bun scripts/check-client-bundle.ts <assetsDir>
```

Byte-identical *leaf* chunks (e.g. archived docs versions or the lazy search
graph) are normal and ignored — only duplication of the context module fails the
check.

## Blog content (Notra)

The blog is powered by [Notra](https://usenotra.com). The site uses **two
rendering paths** for Notra content, both reading the API key server-side only —
no Notra calls ever happen from the browser:

| Path | Surface | Source | When it updates |
| --- | --- | --- | --- |
| **On-demand SSR** | `/blog`, `/blog/$slug` | Live fetch from Notra at request time | Within the edge-cache window (~60s), no rebuild |
| **On-demand SSR (OG images)** | `/og/blog/*` | Live fetch from Notra, rendered to SVG | No rebuild, but cached up to ~1 day (`max-age=86400`) |
| **Build-time snapshot** | `sitemap.xml`, `rss.xml`, `feed.json` | `src/lib/notra-posts.generated.ts`, written at build | On the next deploy |

Both SSR paths pick up new posts without a rebuild, but the OG image SVGs cache
far longer than the blog pages (up to a day vs. ~60s), so a changed post title or
description can keep serving the old image for a while.

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

New and updated posts appear on the live blog pages within the edge-cache window
(~60s) with no rebuild. OG images (`/og/blog/*`) also update without a rebuild
but cache for up to a day, so a changed title or description can keep serving the
old SVG for a while. A rebuild is only needed to refresh the sitemap/RSS/feed
snapshot — the `Refresh blog posts from Notra` GitHub workflow triggers a weekly
Vercel rebuild, and you can point a Notra publish webhook at the same Vercel
deploy hook to refresh those feeds sooner.
