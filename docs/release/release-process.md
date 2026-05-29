# Release Process

This project publishes one package: `@opencoredev/email-sdk`.

That package includes both:

- the SDK imports, such as `@opencoredev/email-sdk/resend`
- the CLI command, `email-sdk`

## One-Time Setup

Do these once:

1. Connect Depot to this GitHub repo.
2. Configure npm Trusted Publishing for `@opencoredev/email-sdk`.
3. Make sure GitHub Actions can create release pull requests.

After that, releases are handled by the repo.

Depot preflight for CI:

```bash
depot ci migrate preflight --org vf16gp9lqr
```

CI does not publish to npm, so it does not need an npm token.

## npm Trusted Publishing

The npm publish step uses GitHub Actions because npm Trusted Publishing currently supports GitHub-hosted runners, GitLab.com shared runners, and CircleCI cloud.

After `@opencoredev/email-sdk` exists on npm, configure Trusted Publishing on npmjs.com:

1. Open the package settings for `@opencoredev/email-sdk`.
2. Go to Trusted Publishing.
3. Choose GitHub Actions.
4. Enter:
   - Organization/user: `opencoredev`
   - Repository: `email-sdk`
   - Workflow filename: `release.yml`
   - Allowed action: `npm publish`

No `NPM_TOKEN` is needed after this.

The same setup can also be done from an authenticated npm CLI:

```bash
npm trust github @opencoredev/email-sdk --repo opencoredev/email-sdk --file release.yml --allow-publish
```

If npm requires the package to exist before Trusted Publishing can be configured, do the first publish manually or with a temporary granular npm token. After the first publish, configure Trusted Publishing and remove the token.

## Optional Depot Secret Migration

If Depot CI ever needs copied GitHub secrets for non-npm work, import them with:

```bash
depot ci migrate secrets-and-vars --org vf16gp9lqr --secrets SOME_SECRET
```

That command creates a one-shot GitHub Actions workflow to copy secret values into Depot CI. Only run it when you intend to perform that migration.

## The Simple Flow

When a PR changes the SDK or CLI, add a changeset:

```bash
bun run changeset
```

This creates a small file with a random friendly name, like:

```txt
.changeset/tall-rivers-smile.md
```

The filename does not matter. The file contents matter: package name, version bump, and changelog note.

Pick the bump:

- `patch` for fixes
- `minor` for new features
- `major` for breaking changes

Then merge PRs normally.

The release workflow collects those changeset files and opens one `Version packages` PR.

When you want to ship a new version, merge that `Version packages` PR.

That is the release button.

Merging `Version packages` does the real release:

1. bumps the package version
2. updates the changelog
3. publishes to npm
4. creates the GitHub release/tag
5. updates the Homebrew formula checksum

## Manual Backup

If the `Version packages` PR did not appear or needs to refresh, go to GitHub Actions and run the `Release` workflow manually.

You normally should not need this.

## Depot

CI runs on Depot.

The active CI workflow lives in `.depot/workflows/ci.yml`.

The important runner line is:

```yaml
runs-on: depot-ubuntu-24.04
```

Depot CI runs these workflows on ephemeral Depot runners.

Publishing to npm runs through `.github/workflows/release.yml` on GitHub-hosted runners so npm Trusted Publishing can work without a long-lived token.

Future agents should not move npm publishing to Depot unless npm Trusted Publishing supports Depot directly or the project intentionally switches back to token-based publishing.

## How Users Upgrade

For Bun/npm users:

```bash
bun update @opencoredev/email-sdk
```

For CLI users through npm:

```bash
bunx @opencoredev/email-sdk@latest adapters
```

For Homebrew users, after the tap exists:

```bash
brew update
brew upgrade email-sdk
```

## Major Versions

A major version means users may need to change code.

Before shipping a major version:

1. Add a migration guide in `docs/release/migrations/vX.md`.
2. Mention breaking changes clearly in the changeset.
3. Add before/after code examples.
4. Update docs examples if imports, options, or behavior changed.
5. Ask an agent to review the migration path using `docs/release/major-version-agent-prompt.md`.

Do not merge the `Version packages` PR for a major release until the migration guide exists.

## Local Checks

Before trusting a release branch:

```bash
bun run release:ci
```

To test the local CLI:

```bash
bun run build
packages/email-sdk/dist/cli.js adapters
```
