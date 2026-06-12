# Email SDK Agent Instructions

These instructions are local to this repository. Keep repo-specific release guidance here instead of global agent memory or global skills.

## Project

- Published packages: `@opencoredev/email-sdk` and `@opencoredev/convex-email`
- CLI binary: `email-sdk`
- Package directories: `packages/email-sdk` and `packages/convex-email`
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

That runs type checks, tests, community registry validation, docs versions validation, build, and npm pack dry-runs for both published packages. Depot CI runs the same command on every PR.

For a quick local CLI smoke test:

```bash
bun run build
packages/email-sdk/dist/cli.js adapters
```

## Other Commands

- `bun run check` — lint and format (`oxlint`, then `oxfmt --write`).
- `bun run community:check` — validate `apps/fumadocs/content/community/plugins.json` against the npm registry.
- `bun run docs:versions:check` — validate versioned docs archives in `apps/fumadocs/content/docs-v/` against the published SDK version.
- `bun run homebrew:update` — point `Formula/email-sdk.rb` at the published npm tarball and refresh its checksum. The release workflow runs this automatically after a publish; do not hand-edit the formula.
- `bun run live:sequenzy` — live Sequenzy account check; requires `SEQUENZY_API_KEY` in the shell or `.env.local`.

## Major Versions

Major versions need migration notes in the PR that introduces the breaking change. Include before/after examples for changed imports, options, CLI flags, adapter behavior, or public types.

Do not merge a `Version packages` PR for a major version unless the migration path is documented.

## CI and Publishing

- Depot CI lives in `.depot/workflows/ci.yml`.
- Release publishing lives in `.github/workflows/release.yml`.
- npm publishing uses GitHub-hosted Actions for Trusted Publishing/OIDC.
- After a successful publish, `release.yml` runs `bun run homebrew:update` and opens an automation PR updating `Formula/email-sdk.rb`.
- `.github/workflows/blog-schedule.yml` triggers a weekly Vercel rebuild so scheduled blog posts go live.
- Do not move npm publishing to Depot unless npm supports Depot as a trusted publisher or the project intentionally switches to token-based publishing.
