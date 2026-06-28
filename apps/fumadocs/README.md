# fumadocs

This is a Tanstack Start application generated with
[Create Fumadocs](https://github.com/fuma-nama/fumadocs).

Run development server:

```bash
bun run dev
```

## Blog content (Notra)

The blog is powered by [Notra](https://usenotra.com). Published posts are pulled
from the Notra API at build time and baked into `src/lib/notra-posts.generated.ts`,
which the blog reads synchronously. This keeps the site fully static, keeps the
API key on the server, and means there are no Notra calls from the browser.

- **`scripts/fetch-notra-posts.ts`** — fetches published posts, renders each
  post's Markdown to sanitized HTML, and writes the generated snapshot. It runs
  automatically before `vite build`, or on demand:

  ```bash
  bun run posts:fetch
  ```

- **Environment** — set `NOTRA_API_KEY`:
  - Local: `apps/fumadocs/.env.local` (gitignored).
  - Production: add `NOTRA_API_KEY` to the Vercel project's environment variables.

  Without the key the fetch is skipped and the last committed snapshot is kept,
  so the build never fails.

New posts appear on the next deploy. The `Refresh blog posts from Notra` GitHub
workflow triggers a weekly Vercel rebuild; you can also point a Notra publish
webhook at the same Vercel deploy hook for instant updates.

### How a Notra post is mapped

Each published post is transformed by `scripts/notra-content.ts` into the
`BlogPost` shape (`src/lib/blog-types.ts`) plus a sanitized HTML body. The rules
below are the authoring contract — what to expect when you write in Notra:

| Field | Source | Notes |
| --- | --- | --- |
| `slug` | always re-slugified | Even an explicit Notra slug is normalized (lowercased, ASCII, `-`-joined, max 80 chars). A value like `release/notes` would otherwise break the single-segment `/blog/$slug` route, OG image path, and prerender, so it is never used verbatim. Collisions get a `-2`, `-3`, … suffix. |
| `title` | post title (trimmed) | Required. A post with no usable title is skipped. |
| `description` | first paragraph of the body | ~155 chars, truncated at a word boundary. Falls back to `"<title> — notes from the Email SDK blog."` when no prose paragraph is found. |
| `publishedAt` | `createdAt` (date only) | `YYYY-MM-DD`, UTC. Drives ordering and public visibility. |
| `updatedAt` | `updatedAt` (date only) | `YYYY-MM-DD`, UTC. |
| `readTime` | body word count | `N min read` at 200 wpm, minimum 1. |
| `image` / `imageAlt` | derived | `/og/blog/<slug>.svg` (generated OG image route) and `"<title> — Email SDK blog"`. |
| `tags` | — | Always empty; Notra tags are not carried over today. |

The body Markdown is rendered (GFM) and sanitized at build time, so it is
injected into the page without a runtime sanitize step. Author with this in mind:

- A single leading `# Title` is stripped — the page already renders the title,
  so a repeated H1 would show up twice.
- HTML is allowlisted (`sanitize-html`): images, headings, figures, tables,
  code, etc. are kept; scripts, iframes, and unknown tags/attributes are dropped.
- External links (`http(s)://…`) get `target="_blank"` + `rel="noopener noreferrer"`;
  images get `loading="lazy"` + `decoding="async"`.
- Allowed URL schemes are `http`, `https`, `mailto` (plus `data:` for `<img>`).

### Visibility rules

- **Drafts are skipped** — only `status: "published"` posts are baked in.
- **Future-dated posts** (a `createdAt` after today) are hidden from the blog
  index but remain reachable by direct URL, so you can share a preview link.
- An empty body renders a "This post does not have any content yet." placeholder;
  with no published posts at all, the index shows a "No posts yet" empty state.

### Post images and CSP

Images embedded in post bodies are served from Notra's CDN. The site's
Content-Security-Policy (`vercel.json`) allows `https://*.usenotra.com` under
`img-src`. If post images ever move to a different host, add it there or they
will be blocked in the browser.

### Troubleshooting

- **A published post isn't showing up** — confirm it is `published` in Notra (not
  a draft) and that its `createdAt` is not in the future; re-run `bun run posts:fetch`
  and check the `[notra]` log line for the written post count.
- **Blog is empty after a build** — usually a missing or invalid `NOTRA_API_KEY`.
  The fetch logs a warning and keeps the last committed snapshot instead of
  failing, so the build still succeeds with whatever was last generated.
- **Regenerate locally** — `bun run posts:fetch` rewrites
  `src/lib/notra-posts.generated.ts`. That file is auto-generated; never edit it by
  hand — commit the regenerated snapshot instead.
- **Post images don't load** — check the browser console for a CSP `img-src`
  violation and verify the image host is allowed in `vercel.json` (see above).
