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

The docs site is `apps/fumadocs`. The blog is powered by [Notra](https://usenotra.com): published posts are fetched at build time by `scripts/fetch-notra-posts.ts` and baked into `src/lib/notra-posts.generated.ts`. The fetch runs automatically before `vite build`, or on demand:

```bash
cd apps/fumadocs && bun run posts:fetch
```

Set `NOTRA_API_KEY` for the fetch (local: `apps/fumadocs/.env.local`; production: the Vercel project env var). Without the key the fetch is skipped and the last committed snapshot is kept. Because turbo runs in strict env mode, `NOTRA_API_KEY` must stay in `passThroughEnv` in `apps/fumadocs/turbo.json` or the Vercel build bakes an empty blog. See `apps/fumadocs/README.md` for details.

New posts appear on the next deploy. The `Refresh blog posts from Notra` workflow (`.github/workflows/blog-schedule.yml`) triggers a Vercel rebuild on a schedule, on `workflow_dispatch`, or on a `notra-published` `repository_dispatch` from a Notra webhook.

## CI and Publishing

- Depot CI lives in `.depot/workflows/ci.yml`.
- Release publishing lives in `.github/workflows/release.yml`.
- npm publishing uses GitHub-hosted Actions for Trusted Publishing/OIDC.
- Do not move npm publishing to Depot unless npm supports Depot as a trusted publisher or the project intentionally switches to token-based publishing.
