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
