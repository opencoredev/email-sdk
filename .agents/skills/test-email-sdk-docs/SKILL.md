---
name: test-email-sdk-docs
description: Launch, preview, or verify the Email SDK docs and marketing site in apps/fumadocs (TanStack Start + Fumadocs). Use for docs content, layout, blog, OG image, or docs build changes, and whenever a preview link is needed.
---

# Test the Email SDK docs site

The site lives in `apps/fumadocs` and deploys to Vercel. Most pages are prerendered. `/blog`, `/blog/$slug`, and `/og/blog/*` render on request from Notra (`src/lib/notra-runtime.ts`).

## Static checks

From `apps/fumadocs`:

```bash
bun run types:check   # fumadocs-mdx + tsc
bun run build         # registry check, module-identity check, Vite build, client-bundle check
```

Run both for any docs-site change. A green build does not prove pages hydrate. The module-identity check exists because a duplicated `fumadocs-core` once built cleanly and then crashed every page in production. From the repo root, `bun run docs:check` also verifies adapter support tables and CLI docs consistency.

Without `NOTRA_API_KEY` (read from `apps/fumadocs/.env.local`), the Notra fetch is skipped. Blog routes then show only the local posts from `localBlogPosts`, which is expected.

## Launch

1. Check for a reusable server first: `ss -ltnp | grep -E ':4000|vite'`. Reuse one only if its working directory is this checkout (`readlink /proc/<pid>/cwd`). Never stop a server another worktree owns.
2. For local-only checks: `bun run dev` (port 4000). If 4000 is taken, pass `--port <free port>`.
3. For a link Leo can open on another device, bind to the Tailscale IPv4 address instead of `0.0.0.0`:

   ```bash
   HOST=$(tailscale ip -4); bun run dev --host "$HOST" --port <free port>
   ```

   Then confirm `curl -sI http://$HOST:<port>/docs` returns 200 from the server before sharing the link. Say which devices were actually tested.

Start it as a tracked background process, wait for Vite's `Local:` or `Network:` line, and stop only the process you started.

If `dev` dies with `EMFILE: too many open files, watch`, the host has run out of inotify instances, which other worktrees share. Don't change sysctl settings. Instead, serve the production build, which needs no watchers: `bun run build`, then `bunx vite preview --host "$HOST" --port <free port>`. You get no hot reload, so rebuild after each edit. This preview serves `.md` routes as `application/octet-stream`; production sets the markdown type through Vercel.

## Drive and verify

Use `agent-browser` with a named headless session, for example `agent-browser --session email-sdk-docs ...`. Driving a browser needs that permission in the current task. Without it, finish the static checks and report the browser proof as NOT CHECKED.

For each change:

- Load the changed route and one neighboring route. Confirm the page hydrated (sidebar and search respond) and the console has no `FrameworkProvider` or hydration errors.
- Check desktop (1280px) and mobile (390px) widths for any layout change.
- For content changes, confirm the raw markdown endpoint (`/docs/<path>.md`) serves the same content. Agents consume that endpoint.
- Capture screenshots as evidence.

## Cleanup

Kill only the dev server PID you started and close your browser session. Leave `.output/` and other build artifacts alone unless you created them for this task.
