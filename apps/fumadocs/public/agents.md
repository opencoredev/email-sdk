# Email SDK — Agent Guide

Machine-facing guide for AI agents and coding assistants. Email SDK is an
open-source **TypeScript SDK** (npm: `@opencoredev/email-sdk`) that sends
transactional email through 20+ providers behind one typed `send()` call. It is
a library you install into an app — not a hosted API or a service you sign up
for. There are no API keys to obtain from us; you bring the provider credentials
the app already has.

- Docs: https://email-sdk.dev/docs
- Machine index: https://email-sdk.dev/llms.txt and https://email-sdk.dev/llms-full.txt
- Source: https://github.com/opencoredev/email-sdk
- Package: https://www.npmjs.com/package/@opencoredev/email-sdk

## When to use Email SDK

Use it when a TypeScript/JavaScript (Node, Bun, or edge/Workers) app needs to:

- Send transactional email (receipts, verifications, alerts, password resets).
- Send through one provider but keep the option to switch or add providers later
  without rewriting send sites.
- Route across multiple providers with retries and compatible fallbacks.
- Give an LLM agent a guarded `send_email` tool that goes through the same
  validated pipeline as the rest of the app.

## When NOT to use it

- You need a marketing/campaign email builder or a CRM — this is transactional sending.
- You are not in a TypeScript/JavaScript runtime.
- You want a hosted email API with its own dashboard and billing — Email SDK wraps
  providers you already pay (Resend, SES, Postmark, SMTP, …); it is not one itself.

## Install and send

```bash
npm install @opencoredev/email-sdk
```

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
  retry: { retries: 1 },
});

await email.send({
  from: "Acme <hello@acme.com>",
  to: "user@example.com",
  subject: "Welcome",
  text: "Your account is ready.",
});
```

Adapters import from their own entry point (`@opencoredev/email-sdk/resend`,
`/smtp`, `/ses`, …). Supported providers: Resend, SMTP, Postmark, SendGrid,
Mailgun, Cloudflare Email Sending, Unosend, AWS SES, MailerSend, Brevo, Mailchimp
Transactional, SparkPost, Iterable, Loops, Sequenzy, Plunk, Mailtrap, Scaleway,
ZeptoMail, and MailPace.

## Give an agent a send tool

`createEmailAgentTools(client)` from `@opencoredev/email-sdk/agent-tools` returns a
`send_email` tool (name, description, JSON-Schema parameters, `execute`) that maps
onto any framework's tool format. `execute` runs the full client pipeline —
validation, retries, fallbacks, plugins, hooks. See
https://email-sdk.dev/docs/agents/skill.

## The email-sdk skill

A skill for coding agents lives at
https://github.com/opencoredev/email-sdk/blob/main/skills/email-sdk/SKILL.md.
Install it with:

```bash
npx skills add opencoredev/email-sdk --skill email-sdk
```

## Constraints for agents

- Keep all provider credentials in environment variables. Never hardcode or log
  API keys, SMTP passwords, raw tokens, full message bodies, or recipient lists.
- Do not add Nodemailer — the SDK ships its own SMTP transport.
- Only configure a fallback adapter that supports the same fields as the primary;
  check https://email-sdk.dev/docs/adapters/field-support first.
- Use idempotency keys for externally visible sends that may be retried.
- Gate agent-initiated sends behind explicit human approval; the tool description
  asks the model to confirm, but you must enforce it.
- Run the CLI `email-sdk doctor` and `send --dry-run` before any live send, and do
  not send real external mail without the user's approval.
