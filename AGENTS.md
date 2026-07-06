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

That runs type checks, tests, community registry + docs version validation,
build, and npm package dry-run.

Lint guidance lives in [Local Checks](#local-checks) below.

For a quick local CLI smoke test:

```bash
bun run build
packages/email-sdk/dist/cli.js adapters
```

## Local Checks

Lint the files you touched before committing:

```bash
bunx oxlint <path>
```

Do not run `bun run check` casually: it runs `oxfmt --write` across the whole
repo, which reformats roughly 170 files that have drifted from the formatter.
CI does not enforce formatting or linting, so a repo-wide reformat only adds
noise to your diff.

When adding or changing a provider adapter, verify it against a live account. These scripts read provider credentials from `.env.local`:

```bash
bun run live:sequenzy
bun run live:lettermint
# Adapters without a script alias run directly:
bun scripts/check-jetemail-account.ts
bun scripts/check-primitive-account.ts
```

## Major Versions

Major versions need migration notes in the PR that introduces the breaking change. Include before/after examples for changed imports, options, CLI flags, adapter behavior, or public types.

Do not merge a `Version packages` PR for a major version unless the migration path is documented.

## Docs Site

The docs/marketing site lives in `apps/fumadocs` (Tanstack Start + Fumadocs) and
deploys to Vercel.

- `cd apps/fumadocs && bun run dev` — local dev server on port 4000.
- `bun run build` — fetches Notra blog posts, then runs the Vite build.
- `bun run posts:fetch` — refresh the build-time Notra snapshot on demand.

The blog is server-rendered on demand: `/blog`, `/blog/$slug`, and `/og/blog/*`
are excluded from prerendering (`vite.config.ts` `prerender.filter`) and fetch
published posts from Notra at request time via `src/lib/notra-runtime.ts`, so
new posts appear without a rebuild. Everything else stays prerendered to static
HTML, and the build-time snapshot still feeds sitemap/rss/feed.

Set `NOTRA_API_KEY` for the blog fetch (local: `apps/fumadocs/.env.local`;
production: the Vercel project env). Without the key the fetch is skipped.

## CI and Publishing

- Depot CI lives in `.depot/workflows/ci.yml`.
- Release publishing lives in `.github/workflows/release.yml`.
- npm publishing uses GitHub-hosted Actions for Trusted Publishing/OIDC.
- After a successful publish, `release.yml` runs `bun run homebrew:update`
  (`scripts/update-homebrew-formula.ts`) to point `Formula/email-sdk.rb` at the
  published npm tarball and refresh its `sha256`, then opens an automation PR.
  Run `bun run homebrew:update` locally to regenerate the formula by hand.
- Do not move npm publishing to Depot unless npm supports Depot as a trusted publisher or the project intentionally switches to token-based publishing.
