# Email SDK Agent Instructions

These instructions are local to this repository. Keep repo-specific release guidance here instead of global agent memory or global skills.

## Project

- Published package: `@opencoredev/email-sdk`
- CLI binary: `email-sdk`
- Package directory: `packages/email-sdk`
- Second published package: `@opencoredev/convex-email` in `packages/convex-email` (also covered by changesets and `pack:check`)
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

## Tests and Lint

Run a single package's tests directly with Bun, optionally filtered by file name:

```bash
cd packages/email-sdk && bun test smtp
```

Lint and format the repo (oxlint + oxfmt, formats in place):

```bash
bun run check
```

<!-- TODO: `.launch-smoke/` holds standalone smoke tests that consume the local packages via `file:` dependencies, but it is not referenced by CI; document how/when to run it once the workflow is confirmed. -->

## Release Checks

Before merging release-sensitive SDK or CLI work, run:

```bash
bun run release:ci
```

That runs type checks, tests, community registry validation (`community:check`), docs version validation (`docs:versions:check`), build, and npm pack dry-runs for both `email-sdk` and `convex-email`. CI (`.depot/workflows/ci.yml`) runs the same command on every PR and push to `main`.

For a quick local CLI smoke test:

```bash
bun run build
packages/email-sdk/dist/cli.js adapters
```

## Major Versions

Major versions need migration notes in the PR that introduces the breaking change. Include before/after examples for changed imports, options, CLI flags, adapter behavior, or public types.

Do not merge a `Version packages` PR for a major version unless the migration path is documented.

## CI and Publishing

- Depot CI lives in `.depot/workflows/ci.yml`.
- Release publishing lives in `.github/workflows/release.yml`.
- npm publishing uses GitHub-hosted Actions for Trusted Publishing/OIDC.
- Do not move npm publishing to Depot unless npm supports Depot as a trusted publisher or the project intentionally switches to token-based publishing.
