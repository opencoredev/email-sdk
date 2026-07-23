# Email SDK Agent Instructions

These instructions are local to this repository. Keep repo-specific release guidance here instead of global agent memory or global skills.

## Project

- Published package: `@opencoredev/email-sdk`
- CLI binary: `email-sdk`
- Package directory: `packages/email-sdk`
- Convex component: `@opencoredev/convex-email` in `packages/convex-email` (see [Convex Component](#convex-component))
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

When adding or changing a provider adapter, verify it against a live account. These scripts read provider credentials from the repo-root `.env.local`, then `.env`, then your shell environment:

```bash
bun run live:resend
bun run live:sequenzy
bun run live:lettermint
# Adapters without a script alias run directly:
bun scripts/check-jetemail-account.ts
bun scripts/check-primitive-account.ts
```

By default they only verify that the credentials authenticate; no email is sent.
Set `<PROVIDER>_LIVE_SEND=true` (plus the provider's from/to env vars, e.g.
`SEQUENZY_LIVE_SEND=true`) to send a real test message.

`adapter-verification.json` is the source of truth for live gates. Add a check
there only after its command is safe by default, emits no credentials, and can
authenticate without sending email. `bun run live:plan <base> <head>` selects
the registered checks affected by a diff; `LIVE_ADAPTERS=all bun run live:plan`
selects every live gate for a manual release rehearsal. `bun run live:run --
<adapter list>` executes the selected checks with every `*_LIVE_SEND` flag
removed from the child environment.

## Telemetry

The SDK and CLI send anonymous PostHog telemetry from
`packages/email-sdk/src/telemetry.ts`.

- `bun test` never sends live telemetry: a Bun `[test] preload`
  (`packages/email-sdk/test-preload.ts`) sets `EMAIL_SDK_TELEMETRY=0` for every
  in-process run, regardless of `NODE_ENV`. Bun only reads the cwd's
  `bunfig.toml`, so the preload is wired from both the repo-root `bunfig.toml`
  and `packages/email-sdk/bunfig.toml` — keep the two entries in sync.
- Tests that need capture enabled construct clients with injected
  `env`/`fetch`/`configDir` overrides instead of relying on `process.env`.
- User-facing opt-outs: `EMAIL_SDK_TELEMETRY=0` (or `DO_NOT_TRACK=1`), or
  `createEmailClient({ telemetry: false })`.

## Convex Component

`@opencoredev/convex-email` (`packages/convex-email`) is a public Convex
Component package. User-visible component changes require a changeset, just
like Email SDK changes. The release workflow publishes it from accumulated
changesets; normal feature PRs do not publish directly.

Its `build`, `test`, and `check-types` scripts run through turbo with the rest
of the workspace, so `release:ci` covers them, and `pack:check` already
includes its `npm pack --dry-run`. Running `bun test` directly inside the
package requires `@opencoredev/email-sdk` to be built first (`bun run build`
at the repo root); turbo handles that ordering for you.

The Convex `_generated/` files under `src/component/_generated` are committed
generic stubs whose types derive from `src/component/schema.ts`, so schema
changes usually do not require regeneration. `bun run codegen` (in the package)
needs a configured Convex deployment, so it is effectively maintainer-only.

## Major Versions

Major versions need migration notes in the PR that introduces the breaking change. Include before/after examples for changed imports, options, CLI flags, adapter behavior, or public types.

Do not merge a `Version packages` PR for a major version unless the migration path is documented.

## Docs Site

The docs/marketing site lives in `apps/fumadocs` (Tanstack Start + Fumadocs) and
deploys to Vercel.

- `cd apps/fumadocs && bun run dev` — local dev server on port 4000.
- `bun run build` — fetches Notra blog posts, then runs the Vite build.
- `bun run posts:fetch` — refresh the build-time Notra snapshot on demand.
- `bun run types:check` — runs `fumadocs-mdx` then `tsc --noEmit`; run this and
  `bun run build` to validate docs-site changes.

The blog is server-rendered on demand: `/blog`, `/blog/$slug`, and `/og/blog/*`
are excluded from prerendering (`vite.config.ts` `prerender.filter`) and fetch
published posts from Notra at request time via `src/lib/notra-runtime.ts`, so
new posts appear without a rebuild. Everything else stays prerendered to static
HTML, and the build-time snapshot still feeds sitemap/rss/feed.

Set `NOTRA_API_KEY` for the blog fetch (local: `apps/fumadocs/.env.local`;
production: the Vercel project env). Without the key the fetch is skipped.

2026-07-07: The app's `lucide-react` version must resolve to the same install
fumadocs-ui uses. lucide-react is a peer dependency of fumadocs-core, so a
version split makes bun materialize fumadocs-core once per peer set; two
fumadocs-core instances mean two React contexts and every page crashes at
hydration with "You need to wrap your application inside `FrameworkProvider`"
while the build stays green (this took production down when a deps refresh
bumped only the app's copy to 1.23.0). `bun run build` now runs
`scripts/check-module-identity.ts` (pre-build, fails on any singleton split:
fumadocs-core, react, react-dom, @tanstack/react-router, lucide-react) and
`scripts/check-client-bundle.ts` (post-build backstop against the bundler
duplicating the framework-context chunk). When bumping lucide-react or
fumadocs packages, bump them together and let the identity check confirm a
single resolution.

`.github/workflows/blog-schedule.yml` refreshes the build-time snapshot
(sitemap/rss/feed) by hitting a Vercel deploy hook on the `notra-published`
`repository_dispatch` event, a daily cron, or manual `workflow_dispatch`. It
needs the `VERCEL_DEPLOY_HOOK_URL` secret; without it the job no-ops.

## Homebrew Formula

`Formula/email-sdk.rb` tracks the latest published npm release. To regenerate
its `url` and `sha256` from the published tarball:

```bash
bun run homebrew:update
```

Only run it once the version is live on npm. After a publish,
`.github/workflows/release.yml` runs it automatically and, if the formula
changed, opens an `automation/homebrew-formula-<version>` PR. Merge that PR to
point Homebrew at the new release.

## CI and Publishing

- Depot CI lives in `.depot/workflows/ci.yml`.
- 2026-07-06: Turbo >=2.9.17 ignores `peerDependencies` when building the
  package graph (vercel/turborepo#13025), so convex-email's
  `@opencoredev/email-sdk` peer range no longer creates the
  `convex-email#test -> email-sdk#build` edge on its own. convex-email
  therefore also lists `@opencoredev/email-sdk` as a `workspace:*` dev
  dependency; keep that entry, or `turbo test` runs the convex-email tests
  against an unbuilt email-sdk and CI fails with "Cannot find module".
  Verify edges with `bunx turbo run test --dry=json`.
- Release publishing lives in `.github/workflows/release.yml`.
- npm publishing uses GitHub-hosted Actions for Trusted Publishing/OIDC.
- After a publish, `release.yml` posts a non-blocking PostHog release
  annotation; it needs the `POSTHOG_PERSONAL_API_KEY` secret and is skipped
  with a notice when the secret is absent.
- Do not move npm publishing to Depot unless npm supports Depot as a trusted publisher or the project intentionally switches to token-based publishing.
