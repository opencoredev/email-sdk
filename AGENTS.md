# Email SDK Agent Instructions

These instructions are local to this repository. Keep repo-specific release guidance here instead of global agent memory or global skills.

## Project

- Published package: `@opencoredev/email-sdk`
- CLI binary: `email-sdk`
- Package directory: `packages/email-sdk`
- Prefer `bun` and `bunx`.

## SDK and CLI Changes

For every user-visible SDK or CLI change, include a changeset in the same PR:

```bash
bun run changeset
```

Pick the bump honestly:

- `patch` for fixes
- `minor` for new features
- `major` for breaking changes

Changesets create random friendly filenames in `.changeset/`. The filename does not need to match the PR name. Commit the generated `.changeset/*.md` file with the code change.

Normal feature PRs do not publish. Changesets accumulate on `main`; the `Version packages` PR is the release button.

## Release Checks

Before merging release-sensitive SDK or CLI work, run:

```bash
bun run release:ci
```

That runs type checks, tests, build, and npm package dry-run.

For a quick local CLI smoke test:

```bash
bun run build
packages/email-sdk/dist/cli.js adapters
```

## Major Versions

Major versions need migration notes in the PR that introduces the breaking change. Include before/after examples for changed imports, options, CLI flags, adapter behavior, or public types.

Do not merge a `Version packages` PR for a major version unless the migration path is documented.

## Docs and Blog

The docs site and blog live in `apps/fumadocs` (Tanstack Start). The blog is powered by [Notra](https://usenotra.com): published posts are fetched at build time and baked into a committed snapshot (`src/lib/notra-posts.generated.ts`) that the blog reads synchronously, so the API key stays server-side.

- `apps/fumadocs/scripts/fetch-notra-posts.ts` runs automatically before `vite build`. Run it on demand from `apps/fumadocs`:

  ```bash
  bun run posts:fetch
  ```

- Set `NOTRA_API_KEY` to pull the latest posts (`apps/fumadocs/.env.local` for local, Vercel project env for production). Without the key the fetch is skipped and the last committed snapshot is kept, so the build never fails.

See `apps/fumadocs/README.md` for details.

## CI and Publishing

- Depot CI lives in `.depot/workflows/ci.yml`.
- Release publishing lives in `.github/workflows/release.yml`.
- `Refresh blog posts from Notra` lives in `.github/workflows/blog-schedule.yml`. It triggers a weekly Vercel rebuild (and is `workflow_dispatch`-able) via the `VERCEL_DEPLOY_HOOK_URL` secret so newly published Notra posts get baked into the static blog.
- npm publishing uses GitHub-hosted Actions for Trusted Publishing/OIDC.
- Do not move npm publishing to Depot unless npm supports Depot as a trusted publisher or the project intentionally switches to token-based publishing.
