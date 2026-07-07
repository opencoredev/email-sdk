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

## Site OG image

`public/og/email-sdk.png` (1200×630) is the site-wide social card — the default
`og:image`/`twitter:image` for every page (`siteOgImageUrl` in
`src/lib/shared.ts`, wired up in `src/lib/metadata.ts`) and the fallback image
on the blog post route when no post is resolved (`src/routes/blog/$slug.tsx`).
It is distinct from the per-post blog OG images
served at `/og/blog/*`, which are rendered live at request time (see the Blog
section above); the site card is a committed PNG regenerated at build time.

The whole image is **drawn in code** by `scripts/og/generate-og-image.ts`, which
builds an SVG — headline, a syntax-highlighted `send.ts` snippet, the provider
logo grid, the sponsor row, and the `npm install` line — and rasterizes it to
PNG with [`@resvg/resvg-js`](https://github.com/yisibl/resvg-js). There is no
hand-edited base art, so the card can't drift from reality.

### What keeps it current

Two values are derived at build time rather than hardcoded, so the image tracks
the codebase:

| Element | Source of truth | How it's derived |
| --- | --- | --- |
| Adapter count (`N PROVIDERS, ONE CLIENT`) | `packages/email-sdk/package.json` `exports` | Counts every export entry except `.`, `./testing`, `./agent-tools`, and `./plugins*`. Providers without a stored logo fold into a trailing `+N` chip. |
| Sponsor row | `src/lib/sponsors.ts` | The same `sponsors` array feeds the website's `SponsorSpotlight` component, so both placements stay in sync. There is no monthly-amount tiering — every listed sponsor appears in both. |

### Regenerating

The generator runs automatically before `vite build` (see the `build` script in
`package.json`). Regenerate on demand after changing the snippet, a logo, the
sponsor list, or the adapter export map:

```bash
bun run og:generate
```

Commit the regenerated `public/og/email-sdk.png` alongside the change. Bump
`VITE_OG_IMAGE_VERSION` (used as the `?v=` cache-buster on `siteOgImageUrl`) when
you want crawlers to re-fetch the card immediately instead of serving a cached
copy.

### Deterministic rendering

Renders are byte-identical between local and CI: logos are inlined as data URIs,
text is set in the bundled Liberation Sans / Liberation Mono fonts under
`scripts/og/fonts/` (metric-compatible with Arial/Courier), and
`loadSystemFonts` is disabled so no machine-specific font can leak in.

### Layout guardrails

The provider grid and the sponsor row have fixed slot counts. If you add enough
entries to overflow either one, the build **throws** rather than drawing chips
off-layout (e.g. at `cy=0` or under the code card). Extend `rowYs` for the
provider grid, or rework the sponsor-row layout, as the error message directs.

### Common changes

- **Add a sponsor:** add an entry to `sponsors` in `src/lib/sponsors.ts` and drop
  its logo under `public/og/provider-logos/`. This updates both the OG image and
  the website spotlight.
- **Add a provider logo to the grid:** add a `{ file }` entry to `providerLogos`
  in `generate-og-image.ts` (set `dark: true` for white/light marks so they get
  a dark chip) and place the file under `public/og/provider-logos/`. Providers
  left out of the array still count toward the `+N` chip via the export map.
