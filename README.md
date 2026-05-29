# Email SDK

A lightweight TypeScript SDK for unified email sending. One clean API, swappable adapters, fallbacks, hooks, a Bun CLI, and Fumadocs documentation.

## Packages

- `packages/email-sdk` - core SDK, adapters, CLI, tests
- `apps/fumadocs` - documentation site
- `skills/email-sdk` - repo-local agent skill for Email SDK integrations

## Quickstart

```bash
bun add @opencoredev/email-sdk
```

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

## Development

```bash
bun install
bun run check-types
bun test
bun run build
```

## Releases

Releases use Changesets, Depot-backed GitHub Actions runners, npm, and the repo-local Homebrew formula. See [docs/release/release-process.md](docs/release/release-process.md).

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
