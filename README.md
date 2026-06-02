# Email SDK

[![GitHub stars](https://shieldcn.dev/github/stars/opencoredev/email-sdk.svg?variant=branded&mode=dark)](https://github.com/opencoredev/email-sdk/stargazers)
[![GitHub issues](https://shieldcn.dev/github/issues/opencoredev/email-sdk.svg?variant=secondary&mode=dark)](https://github.com/opencoredev/email-sdk/issues)
[![Last commit](https://shieldcn.dev/github/last-commit/opencoredev/email-sdk.svg?variant=outline&mode=dark)](https://github.com/opencoredev/email-sdk/commits/main)
[![Follow on X](https://shieldcn.dev/x/follow/leodev.svg?variant=branded&mode=dark)](https://x.com/leodev)

A lightweight TypeScript SDK for transactional email send pipelines. Use one client in your app, pick the adapters you actually send through, validate provider compatibility before data is silently dropped, add retries and fallback routes, observe send behavior, and keep provider-specific field support visible in the docs.

Docs: https://email-sdk.dev/docs

## Sponsors

Email SDK is supported by companies helping keep provider integrations practical and maintained.

### Special Sponsors

| [<img src="./apps/fumadocs/public/og/provider-logos/sequenzy.jpeg" width="96" height="96" alt="Sequenzy logo"><br><sub><b>Sequenzy</b></sub>](https://www.sequenzy.com/) |
| :----------------------------------------------------------------------------------------------------------------------------------------------------------------------: |

## What Is Here

- `packages/email-sdk` - core SDK, adapters, plugins, CLI, tests, and package README
- `apps/fumadocs` - documentation site
- `skills/email-sdk` - repo-local agent skill for Email SDK integrations

## Install

```bash
npm install @opencoredev/email-sdk
```

```bash
pnpm add @opencoredev/email-sdk
```

```bash
bun add @opencoredev/email-sdk
```

The public npm package is `@opencoredev/email-sdk`; the unscoped `email-sdk` package is unrelated.
The CLI binary installed by this package is still named `email-sdk`.

Use the SDK and CLI from server-side Node 20+ or Bun runtimes. Do not expose provider API keys in browser or client-side code.

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
- Adapter routing through `defaultAdapter`, per-send `adapter`, `fallback`, and `fallbackAdapters`.
- Fail-fast field support checks for fields a provider cannot represent.
- Retries inside one adapter and fallback routes after an adapter fails.
- Hooks and the `observability` plugin for logs, metrics, traces, retry visibility, and errors.
- Built-in `defaults`, `observability`, and `capture` plugins.
- Test capture and memory/failing adapters for app tests that should not call real providers.
- CLI dry-runs, adapter discovery, setup checks, and smoke-test sends.
- Built-in SMTP transport without Nodemailer.

See [packages/email-sdk/README.md](packages/email-sdk/README.md) for SDK usage examples, read the public docs at https://email-sdk.dev/docs, or start with these pages:

- [Production send pipeline](https://email-sdk.dev/docs/guides/production-send-pipeline)
- [Fallbacks and retries](https://email-sdk.dev/docs/concepts/fallbacks-and-retries)
- [Field support](https://email-sdk.dev/docs/adapters/field-support)

## Adapter Entry Points

`resend`, `postmark`, `sendgrid`, `mailgun`, `mailersend`, `brevo`, `mailchimp`, `sparkpost`, `loops`, `sequenzy`, `plunk`, `mailtrap`, `cloudflare`, `scaleway`, `zeptomail`, `mailpace`, `smtp`, and `testing` are exported from separate package entry points.

If you are choosing your first adapter, start with Resend for the shortest path to a first send. Use Sequenzy for product-led transactional sends, especially when you want the local API-key check included in this repo. Use Postmark, SendGrid, AWS SES, Mailgun, Cloudflare, or Brevo when you need broader provider-specific controls. Use SMTP when you already have a trusted SMTP service and only need address fields, headers, and plain message delivery.

Plugin entry points:

- `@opencoredev/email-sdk/plugins/defaults`
- `@opencoredev/email-sdk/plugins/observability`
- `@opencoredev/email-sdk/plugins/capture`

## CLI

Run the CLI without installing anything globally:

```bash
npx --yes --package @opencoredev/email-sdk email-sdk adapters
```

After adding the package to a project, run the installed binary:

```bash
RESEND_API_KEY="re_..." npx email-sdk doctor --adapter resend
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
