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
  - Local: `apps/fumadocs/.env.local` (gitignored). Bun auto-loads this file, so
    local builds pick up the key without any extra wiring.
  - Production: add `NOTRA_API_KEY` to the Vercel project's environment variables
    **and** keep it listed in `passThroughEnv` in `apps/fumadocs/turbo.json`.
    Turbo runs in strict env mode, so it strips any variable the build task does
    not explicitly declare — a Vercel env var that is not in `passThroughEnv`
    never reaches `scripts/fetch-notra-posts.ts`.

  Without the key the fetch is skipped and the last committed snapshot is kept,
  so the build never fails.

New posts appear on the next deploy. The `Refresh blog posts from Notra` GitHub
workflow triggers a daily Vercel rebuild; you can also point a Notra publish
webhook at the same Vercel deploy hook for instant updates.

### Troubleshooting: the deployed blog is empty

If the live blog renders no posts even though they are published in Notra, the
build almost certainly ran without the API key:

1. Check the Vercel build log for
   `[notra] NOTRA_API_KEY is not set — skipping fetch`. When you see it, the
   fetch was skipped and the committed (often empty) snapshot was shipped.
2. Confirm `NOTRA_API_KEY` is set on the Vercel project **and** that
   `"passThroughEnv": ["NOTRA_API_KEY"]` is present in `apps/fumadocs/turbo.json`.
   Missing the `passThroughEnv` entry is the usual cause: the key exists in
   Vercel but turbo's strict env mode hides it from the build.
3. Redeploy. A successful run logs
   `[notra] wrote N published post(s) to src/lib/notra-posts.generated.ts`.

Local builds can mask this because Bun loads `.env.local` directly, bypassing
turbo's env filtering — so a missing `passThroughEnv` only surfaces in CI/Vercel.
