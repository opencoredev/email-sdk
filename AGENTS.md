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

## Docs Site

The docs and blog site is the `fumadocs` app in `apps/fumadocs`. Blog posts are pulled from Notra and baked into the static build.

The build re-fetches posts on every run (`apps/fumadocs/turbo.json` disables build caching for the docs app), so a redeploy of the same commit still picks up newly published posts. To fetch posts without a full build:

```bash
cd apps/fumadocs
bun run posts:fetch
```

Production rebuilds are triggered by the `.github/workflows/blog-schedule.yml` workflow ("Refresh blog posts from Notra"), which POSTs the `VERCEL_DEPLOY_HOOK_URL` secret. It runs on a daily schedule, on manual `workflow_dispatch`, and on a `repository_dispatch` `notra-published` event (point a Notra publish webhook at it for near-instant updates). It no-ops cleanly until `VERCEL_DEPLOY_HOOK_URL` is set.

## CI and Publishing

- Depot CI lives in `.depot/workflows/ci.yml`.
- Release publishing lives in `.github/workflows/release.yml`.
- Blog rebuilds live in `.github/workflows/blog-schedule.yml`.
- npm publishing uses GitHub-hosted Actions for Trusted Publishing/OIDC.
- Do not move npm publishing to Depot unless npm supports Depot as a trusted publisher or the project intentionally switches to token-based publishing.
