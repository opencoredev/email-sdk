# Email SDK

[![GitHub stars](https://shieldcn.dev/github/stars/opencoredev/email-sdk.svg?variant=branded&mode=dark)](https://github.com/opencoredev/email-sdk/stargazers)
[![GitHub issues](https://shieldcn.dev/github/issues/opencoredev/email-sdk.svg?variant=secondary&mode=dark)](https://github.com/opencoredev/email-sdk/issues)
[![Last commit](https://shieldcn.dev/github/last-commit/opencoredev/email-sdk.svg?variant=outline&mode=dark)](https://github.com/opencoredev/email-sdk/commits/main)
[![Follow on X](https://shieldcn.dev/x/follow/leodev.svg?variant=branded&mode=dark)](https://x.com/leodev)

A lightweight TypeScript SDK for transactional email. Use one client in your app, pick the adapters you actually send through, add plugins for shared behavior, and keep provider-specific field support visible in the docs.

Docs: https://email-sdk.dev/docs

## What Is Here

- `packages/email-sdk` - core SDK, adapters, plugins, CLI, tests, and package README
- `apps/fumadocs` - documentation site
- `skills/email-sdk` - repo-local agent skill for Email SDK integrations

## Install

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

## SDK Surface

- One normalized `EmailMessage` shape.
- Direct provider adapters through `adapters`.
- Adapter plugins through `plugins`.
- Fallbacks, retries, hooks, and per-send routing.
- Built-in `defaults`, `observability`, and `capture` plugins.
- Built-in SMTP transport without Nodemailer.
- Fail-fast adapter validation for fields a provider cannot represent.

See [packages/email-sdk/README.md](packages/email-sdk/README.md) for SDK usage examples, or read the public docs at https://email-sdk.dev/docs.

## Adapter Entry Points

`resend`, `postmark`, `sendgrid`, `mailgun`, `mailersend`, `brevo`, `mailchimp`, `sparkpost`, `loops`, `plunk`, `mailtrap`, `scaleway`, `zeptomail`, `mailpace`, `smtp`, and `testing` are exported from separate package entry points.

Plugin entry points:

- `@opencoredev/email-sdk/plugins/defaults`
- `@opencoredev/email-sdk/plugins/observability`
- `@opencoredev/email-sdk/plugins/capture`

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
bun test
bun run check-types
bun run build
```

Useful workspace scripts:

- `bun run build` - build packages and apps through Turbo
- `bun run check-types` - run TypeScript checks across the workspace
- `bun test` - run package tests
- `bun run check` - run Oxlint and Oxfmt with write formatting
- `bun run dev` - start the docs dev server through Turbo

## Releases

Releases use Changesets, Depot-backed GitHub Actions runners, npm, and the repo-local Homebrew formula. Release operator notes live in [AGENTS.md](AGENTS.md).

Do not start the docs dev server unless you actually want a local preview.

## Reliability Notes

The SDK validates messages locally and adapter tests verify payload mapping with injected fetch calls. Real provider sends still depend on live account setup: verified domains, sender identities, API scopes, sandbox settings, regions, rate limits, and provider-specific policy.

Before production use, configure one primary adapter, add a fallback adapter where delivery matters, and run a live smoke send from the target environment.
