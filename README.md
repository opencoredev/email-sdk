# Email SDK

[![GitHub stars](https://shieldcn.dev/github/stars/opencoredev/email-sdk.svg)](https://github.com/opencoredev/email-sdk/stargazers)
[![GitHub release](https://shieldcn.dev/github/release/opencoredev/email-sdk.svg)](https://github.com/opencoredev/email-sdk/releases)
[![GitHub issues](https://shieldcn.dev/github/issues/opencoredev/email-sdk.svg)](https://github.com/opencoredev/email-sdk/issues)
[![skills.sh](https://skills.sh/b/opencoredev/email-sdk)](https://skills.sh/opencoredev/email-sdk)
[![Follow on X](https://shieldcn.dev/x/follow/leodev.svg?variant=branded)](https://x.com/leodev)

A lightweight TypeScript SDK for transactional email. Use one client in your app, pick the adapters
you actually send through, and keep provider-specific field support visible in the docs.

## Packages

- `packages/email-sdk` - core SDK, adapters, CLI, tests
- `apps/fumadocs` - documentation site
- `skills/email-sdk` - repo-local agent skill for Email SDK integrations

## Quickstart

```bash
bun add @opencoredev/email-sdk
```

The public npm package is `@opencoredev/email-sdk`; the unscoped `email-sdk` package is unrelated.
The CLI binary installed by this package is still named `email-sdk`.

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
});

await email.send({
  from: "Acme <hello@acme.com>",
  to: "user@example.com",
  subject: "Welcome",
  html: "<p>It works.</p>",
});
```

SMTP is built in and does not require Nodemailer.

Adapters are stable by contract: they map supported `EmailMessage` fields and reject unsupported fields instead of silently dropping them.

## CLI

Run the CLI without installing anything globally:

```bash
bunx --yes @opencoredev/email-sdk adapters
```

After adding the package to a project, run the installed binary with Bun:

```bash
bun email-sdk doctor --adapter resend
```

## Agent Skill

Install the Email SDK agent skill from skills.sh when you want an AI agent to add, review, or document an integration:

```bash
npx skills add opencoredev/email-sdk --skill email-sdk
```

The skill is stored in `skills/email-sdk/SKILL.md`. It tells agents to refresh the current README, Fumadocs pages, package exports, and TypeScript declarations before implementing, so the guidance stays useful as the SDK evolves without needing every new adapter or option copied into the skill.

## Development

```bash
bun install
bun run check-types
bun test
bun run build
```

## Releases

Releases use Changesets, Depot-backed GitHub Actions runners, npm, and the repo-local Homebrew formula. See [AGENTS.md](AGENTS.md).

Do not run the docs dev server unless you actually want a local preview:

```bash
bun run dev
```

## Available Scripts

- `bun run build`: build all packages and apps
- `bun run check-types`: check TypeScript types across the workspace
- `bun test`: run package tests
- `bun run check`: Run Oxlint and Oxfmt
- `bun run dev`: start the docs dev server through Turbo
