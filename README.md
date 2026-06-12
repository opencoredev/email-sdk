<div align="center">

<img src="./logo.png" alt="Email SDK logo" width="120" height="120" />

# Email SDK

**A small, typed TypeScript SDK for production transactional email.**
One client, one message shape, the providers you actually send through.

[![GitHub stars](https://shieldcn.dev/github/stars/opencoredev/email-sdk.svg?variant=branded&mode=dark)](https://github.com/opencoredev/email-sdk/stargazers)
[![GitHub issues](https://shieldcn.dev/github/issues/opencoredev/email-sdk.svg?variant=secondary&mode=dark)](https://github.com/opencoredev/email-sdk/issues)
[![Last commit](https://shieldcn.dev/github/last-commit/opencoredev/email-sdk.svg?variant=outline&mode=dark)](https://github.com/opencoredev/email-sdk/commits/main)
[![Follow on X](https://shieldcn.dev/x/follow/leodev.svg?variant=branded&mode=dark)](https://x.com/leodev)

[Documentation](https://email-sdk.dev/docs) · [Quickstart](https://email-sdk.dev/docs/getting-started/quickstart) · [Adapters](https://email-sdk.dev/docs/adapters/field-support) · [npm](https://www.npmjs.com/package/@opencoredev/email-sdk)

</div>

---

Email SDK gives your application one typed `send` call and lets the configured adapters decide how that message maps to Resend, Postmark, SendGrid, Mailgun, AWS SES, SMTP, or another provider. You get explicit adapter routing, fail-fast provider compatibility checks, retries, fallback routes, observability hooks, reusable plugins, test capture, and a CLI for verification — without a campaign tool, queue, or template engine attached.

It is the layer many apps keep rebuilding: adapter setup, one consistent send call, typed errors, provider compatibility checks, and fallback routes explicit enough to debug.

## Quickstart

Install the scoped package with the package manager your app already uses:

```bash
npm install @opencoredev/email-sdk
```

```bash
pnpm add @opencoredev/email-sdk
```

```bash
bun add @opencoredev/email-sdk
```

Set `RESEND_API_KEY`, then create a client and send:

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

The public npm package is `@opencoredev/email-sdk`; the unscoped `email-sdk` package is unrelated. The CLI binary it installs is named `email-sdk`. Use the SDK and CLI from server-side Node 20+ or Bun runtimes, and never expose provider API keys in browser or client-side code.

New to the SDK? Follow the [Quickstart](https://email-sdk.dev/docs/getting-started/quickstart), then wire a real app with the [Production send pipeline](https://email-sdk.dev/docs/guides/production-send-pipeline).

## Why Email SDK

- **One entry point, one shape.** A single `createEmailClient` and one normalized `EmailMessage` work across every provider.
- **Explicit routing.** Choose routes with `defaultAdapter`, a per-send `adapter`, `fallback`, and `fallbackAdapters`.
- **Fail-fast compatibility.** Adapters reject fields a provider cannot represent instead of silently dropping them.
- **Retries and fallback.** Retries run inside one adapter; fallback routes take over only after an adapter has finally failed.
- **Observability built in.** Hooks and the observability plugin expose logs, metrics, traces, retry visibility, and errors.
- **Reusable plugins.** Compose shared defaults, observability, capture, adapter registration, and client extensions.
- **Testable sends.** Memory and failing test adapters plus the capture plugin assert send behavior without calling real providers.
- **CLI verification.** Discover adapters, run setup checks, dry-run a message, and run a real smoke send.
- **No runtime dependencies.** SMTP transport is built in — no Nodemailer required.

## What stays small

Email SDK is not a campaign tool, queue, template engine, hosted analytics product, or full email operations suite. It does one thing: turn a typed message into a delivered send across providers you can swap, with errors you can debug. When you need durable queues and reactive delivery state on top of it, reach for [Convex Email Ops](#convex-email-ops).

## Adapters

Each adapter ships from its own entry point, so apps import only what they send through.

| If you want…                            | Start with                                              |
| --------------------------------------- | ------------------------------------------------------- |
| The fastest first send                  | Resend                                                  |
| Mature transactional delivery controls  | Postmark, SendGrid, AWS SES, Mailgun, Unosend, or Brevo |
| A backup route for production delivery   | A primary API adapter plus Postmark or SMTP             |
| Product-triggered emails                | Iterable, Sequenzy, Loops, or Plunk                     |
| A cheap or self-managed transport       | SMTP                                                    |

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { resend } from "@opencoredev/email-sdk/resend";

const email = createEmailClient({
  adapters: [
    resend({ apiKey: process.env.RESEND_API_KEY! }),
    postmark({ serverToken: process.env.POSTMARK_SERVER_TOKEN! }),
  ],
  defaultAdapter: "resend",
  fallback: ["postmark"],
});
```

All 20 adapters are exported from their own subpath — `@opencoredev/email-sdk/<name>`:

`resend`, `postmark`, `sendgrid`, `mailgun`, `mailersend`, `brevo`, `mailchimp`, `sparkpost`, `iterable`, `loops`, `sequenzy`, `plunk`, `mailtrap`, `cloudflare`, `unosend`, `ses`, `scaleway`, `zeptomail`, `mailpace`, and `smtp`. The `@opencoredev/email-sdk/testing` entry point provides memory and failing adapters for tests.

Use a fallback route only when the backup adapter can represent the same message fields that matter to your app. See [Field support](https://email-sdk.dev/docs/adapters/field-support) before choosing backup routes, and [Fallbacks and retries](https://email-sdk.dev/docs/concepts/fallbacks-and-retries) for route order, retry behavior, and idempotency.

## Plugins

Plugins can register adapters, add middleware, compose hooks, and extend the returned client. Plugin order is deterministic: direct adapters register first, plugins run in array order, and plugin hooks run before user hooks.

| Entry point                                    | Use it for                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `@opencoredev/email-sdk/plugins/defaults`      | Default headers, tags, metadata, reply-to, and idempotency keys      |
| `@opencoredev/email-sdk/plugins/observability` | Redacted log, metric, or trace callbacks                             |
| `@opencoredev/email-sdk/plugins/capture`       | Test-only capture of attempted sends, retries, responses, and errors |

Read the [plugin guide](https://email-sdk.dev/docs/plugins) to write and publish your own.

## CLI

Run the CLI once without installing anything:

```bash
bunx --bun --package @opencoredev/email-sdk email-sdk adapters
```

After adding the package to a project, run the installed binary:

```bash
# Check that an adapter has the environment it needs
RESEND_API_KEY="re_..." npx email-sdk doctor --adapter resend

# Validate a message and adapter field support without sending
npx email-sdk send --dry-run --adapter resend \
  --from "Acme <hello@acme.com>" --to "user@example.com" \
  --subject "Hello" --text "It works"
```

Commands: `adapters`, `doctor`, `send` (with `--dry-run`), `version`, and `help`. The CLI reads provider credentials from environment variables or matching credential flags. See the [CLI reference](https://email-sdk.dev/docs/reference/cli) for every flag.

## Convex Email Ops

Need durable queued sends, idempotency, webhook ingestion, and reactive delivery state? [`@opencoredev/convex-email`](packages/convex-email/README.md) wraps this SDK as a Convex Component so apps can queue transactional email from mutations and store status, retries, and attempted-adapter history in Convex tables.

## Provider behavior is not hidden

The official API adapters are covered by local payload and validation tests, and Email SDK validates every message before it leaves your app. A live provider send still depends on account setup: verified sender domains, sandbox modes, API scopes, regions, rate limits, and provider policy.

Before production use, configure one primary adapter, add a fallback adapter where delivery matters, run the CLI dry run, then run one real smoke send from the environment that will send production email.

## Repository layout

This is a monorepo for the SDK and everything that supports it:

- `packages/email-sdk` — the core SDK, adapters, plugins, CLI, tests, and package README
- `packages/convex-email` — Convex Email Ops, the durable-queue Convex Component built on the SDK
- `apps/fumadocs` — the documentation site behind [email-sdk.dev](https://email-sdk.dev/docs)
- `skills/email-sdk` — repo-local agent skill for Email SDK integrations

## Agent skill

Install the Email SDK agent skill from skills.sh when you want an AI agent to add, review, or document an integration:

```bash
npx skills add opencoredev/email-sdk --skill email-sdk
```

The skill lives in `skills/email-sdk/SKILL.md`. It tells agents to refresh the current README, Fumadocs pages, package exports, and TypeScript declarations before implementing, so the guidance stays accurate as the SDK adds adapters and options.

## Development

```bash
bun install
bun test
bun run check-types
bun run build
```

Useful workspace scripts:

- `bun run build` — build packages and apps through Turbo
- `bun run check-types` — run TypeScript checks across the workspace
- `bun test` — run package tests
- `bun run check` — run Oxlint and Oxfmt with write formatting
- `bun run dev` — start the docs dev server through Turbo (only when you want a local preview)

For a quick CLI smoke test after a build:

```bash
bun run build
packages/email-sdk/dist/cli.js adapters
```

## Releases

Releases use Changesets, Depot-backed GitHub Actions runners, npm, and the repo-local Homebrew formula. Every user-visible SDK or CLI change should ship with a changeset (`bun run changeset`) in the same PR; changesets accumulate on `main`, and the `Version packages` PR is the release button. Release operator notes live in [AGENTS.md](AGENTS.md).

## Sponsors

Email SDK is supported by companies helping keep provider integrations practical and maintained.

| [<img src="./apps/fumadocs/public/og/provider-logos/resend-wordmark.jpg" width="260" height="55" alt="Resend logo"><br><sub><b>Resend</b></sub>](https://go.resend.com/email-sdk)<br><sub>[Docs](https://email-sdk.dev/docs/adapters/resend)</sub> | [<img src="./apps/fumadocs/public/og/provider-logos/sequenzy.jpeg" width="96" height="96" alt="Sequenzy logo"><br><sub><b>Sequenzy</b></sub>](https://www.sequenzy.com/)<br><sub>[Docs](https://email-sdk.dev/docs/adapters/sequenzy)</sub> |
| :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: | :-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------: |

## License

Released under the [MIT License](https://opensource.org/licenses/MIT).
