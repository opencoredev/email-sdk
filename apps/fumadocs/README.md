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

### How new posts go live

Publishing a post in Notra does **not** update the site on its own — the snapshot
is regenerated only when the blog is rebuilt. A new post appears once a deploy
re-runs `fetch-notra-posts.ts` and ships a fresh `notra-posts.generated.ts`.

Build caching is intentionally disabled for this app in `apps/fumadocs/turbo.json`
(`"cache": false`). Without it, rebuilding the same commit can hit the turbo/Vercel
build cache and skip the Notra fetch, so a newly published post never appears
(only a forced no-cache build would pick it up). With caching off, every deploy
re-runs the fetch.

### Refresh workflow and deploy hook

The `Refresh blog posts from Notra` GitHub workflow
(`.github/workflows/blog-schedule.yml`) triggers a Vercel rebuild — which re-fetches
the latest published posts plus the sitemap, RSS, and JSON feed. It runs on three
triggers:

- **`repository_dispatch`** with event type `notra-published` — point a Notra
  "post published" webhook at GitHub's `repository_dispatch` API for near-instant
  updates.
- **`schedule`** — a daily rebuild (`30 13 * * *`) as a safety net in case a
  webhook is missed.
- **`workflow_dispatch`** — manual rebuild from the Actions tab.

The workflow POSTs to a Vercel **Deploy Hook**. To enable it, create the hook
(Vercel project → **Settings → Git → Deploy Hooks**, branch `main`) and store its
URL as the `VERCEL_DEPLOY_HOOK_URL` repository secret. Until that secret is set the
workflow no-ops cleanly (it logs a notice and exits 0) rather than failing.
