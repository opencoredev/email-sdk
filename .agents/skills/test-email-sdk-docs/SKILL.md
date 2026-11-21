---
name: test-email-sdk-docs
description: Launch, preview, or verify the Email SDK docs and marketing site in apps/docs (Blume). Use for docs content, layout, blog, OG image, or docs build changes, and whenever a preview link is needed.
---

# Test the Email SDK docs site

The site lives in `apps/docs`, built with [Blume](https://useblume.dev) (Astro), and deploys to Vercel as server output (`deployment: vercel()`), so `/mcp` and `Accept: text/markdown` work. Docs are `content/docs`, blog posts `content/blog`, the compare pages `content/compare` (generated from `lib/compare.ts`), and the archived versions `content/v<release>/docs`. The landing page is `pages/index.astro`.

## Static checks

From `apps/docs` (Blume needs Node 22.19 or later):

```bash
bun run types:check   # tsc over lib/, components/, scripts/
bun run validate      # blume validate --strict: links, anchors, assets, redirects
bun run build         # prebuild generators and checks, blume build, Vercel header patch
bun run audit         # blume audit over the build: redirects, links, metadata
```

Run `types:check`, `validate`, and `build` for any docs-site change. From the repo root, `bun run docs:check` also verifies adapter support tables, CLI docs consistency, the generated adapter FAQ and compare pages, and the email registry. After editing `lib/compare.ts` run `bun run compare:generate`; after editing adapter support data run `bun run adapter-faq:generate`.

Without `NOTRA_API_KEY` (read from `apps/docs/.env.local`), the Notra fetch is skipped and the blog shows only the committed posts in `content/blog`, which is expected.

## Launch

1. Check for a reusable server first: `ss -ltnp | grep -E ':4321|astro|blume'`. Reuse one only if its working directory is this checkout (`readlink /proc/<pid>/cwd`). Never stop a server another worktree owns.
2. For local-only checks: `bun run dev` (port 4321). If it is taken, pass `--port <free port>`.
3. For a link Leo can open on another device, bind to the Tailscale IPv4 address instead of `0.0.0.0`:

   ```bash
   HOST=$(tailscale ip -4); bun run dev --host "$HOST" --port <free port>
   ```

   Then confirm `curl -sI http://$HOST:<port>/docs` returns 200 from the server before sharing the link. Say which devices were actually tested.

Start it as a tracked background process, wait for the `Local` line Blume prints, and stop only the process you started.

If `dev` dies with `EMFILE: too many open files, watch`, the host has run out of inotify instances, which other worktrees share. Don't change sysctl settings. Instead, serve the production build, which needs no watchers: `bun run build`, then `bun run preview -- --host "$HOST" --port <free port>`. You get no hot reload, so rebuild after each edit.

## Drive and verify

Use `agent-browser` with a named headless session, for example `agent-browser --session email-sdk-docs ...`. Driving a browser needs that permission in the current task. Without it, finish the static checks and report the browser proof as NOT CHECKED.

For each change:

- Load the changed route and one neighboring route. Confirm search and the sidebar respond and the console has no errors.
- Check desktop (1280px) and mobile (390px) widths for any layout change.
- For content changes, confirm the raw markdown endpoint (`/docs/<path>.md`) serves the same content. Agents consume that endpoint.
- Capture screenshots as evidence.

## Cleanup

Kill only the dev server PID you started and close your browser session. Leave `dist/`, `.blume/`, `.vercel/` and other build artifacts alone unless you created them for this task.
