# Email SDK

A lightweight TypeScript SDK for unified email sending and receiving. One clean send API, a first-class inbound parser, swappable adapters, fallbacks, hooks, a Bun CLI, and Fumadocs documentation.

## Packages

- `packages/email-sdk` - core SDK, adapters, CLI, tests
- `apps/fumadocs` - documentation site
- `skills/email-sdk` - repo-local agent skill for Email SDK integrations

## Quickstart

```bash
bun add email-sdk
```

```ts
import { createEmailClient } from "email-sdk";
import { resend } from "email-sdk/resend";

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

Receive inbound webhook payloads with a separate client:

```ts
import { createInboundEmailClient } from "email-sdk";
import { resendInbound } from "email-sdk/inbound/resend";

const inbound = createInboundEmailClient({
  adapters: [resendInbound({ webhookSecret: process.env.RESEND_WEBHOOK_SECRET })],
});

const event = await inbound.parse(request);
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
