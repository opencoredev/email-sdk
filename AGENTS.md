# Email SDK Agent Instructions

These instructions are local to this repository. Keep repo-specific release guidance here instead of global agent memory or global skills.

## Project

- Published package: `@opencoredev/email-sdk`
- CLI binary: `email-sdk`
- Package directory: `packages/email-sdk`
- Convex component package: `@opencoredev/convex-email` in `packages/convex-email` (see Convex Component).
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

## Convex Component

The `@opencoredev/convex-email` package in `packages/convex-email` is currently `private` in its
`package.json`. Combined with `privatePackages.version: false` in `.changeset/config.json`, this means
changesets do not version or publish it. Do not add a changeset for convex-email-only changes.

Run the package checks locally from its directory:

```bash
cd packages/convex-email
bun run check-types
bun test
```

After changing the component schema (`src/component/schema.ts`), regenerate Convex types with
`bun run codegen`. The committed `_generated` stubs derive their types from the schema, so most
schema additions do not require regeneration.

## CI and Publishing

- Depot CI lives in `.depot/workflows/ci.yml`.
- Release publishing lives in `.github/workflows/release.yml`.
- npm publishing uses GitHub-hosted Actions for Trusted Publishing/OIDC.
- Do not move npm publishing to Depot unless npm supports Depot as a trusted publisher or the project intentionally switches to token-based publishing.
