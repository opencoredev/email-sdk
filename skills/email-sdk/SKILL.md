---
name: email-sdk
description: Use when adding, reviewing, or documenting Email SDK integrations in TypeScript/Bun apps. Dynamically refreshes the current Email SDK docs/source before implementation, then covers adapter selection, fallbacks, CLI smoke tests, hooks, and secret-safe observability.
---

# Email SDK

Use this skill when an agent works with this repository or wires `email-sdk` into another TypeScript app.

This skill is intentionally dynamic: do not treat the examples below as the full current API. First refresh the local package docs/source for the installed version, then implement against what the repo or dependency actually exposes.

## Refresh Current Docs

Before changing code, inspect the most relevant current sources:

1. If you are inside this repo, read:
   - `README.md`
   - `packages/email-sdk/README.md`
   - `packages/email-sdk/package.json`
   - `apps/fumadocs/content/docs/**/*.mdx`
   - `packages/email-sdk/src/index.ts`
   - the specific adapter file in `packages/email-sdk/src/<adapter>.ts`
   - `packages/email-sdk/src/types.ts`, `core.ts`, and `errors.ts` when message shape, routing, retries, hooks, or error handling matter.
2. If you are inside an app that has `email-sdk` installed, inspect:
   - the app lockfile and `node_modules/email-sdk/package.json`
   - `node_modules/email-sdk/README.md`
   - `node_modules/email-sdk/dist/*.d.ts`
   - the app's existing email, notification, queue, environment, and test patterns.
3. If local docs are missing or the task depends on version-sensitive behavior, fetch the current published package metadata/docs before implementing:
   - `bun pm view email-sdk`
   - `bunx --yes jsr info email-sdk` only if the project is using JSR
   - the repository docs or package README for the exact version in use.

When local source and external docs disagree, prefer the code/types for the exact installed version and mention the mismatch.

## Defaults

- Prefer `bun` and `bunx`.
- Keep the core dependency-free.
- Import adapters from separate entry points such as `email-sdk/resend`, `email-sdk/smtp`, and the adapter-specific entry point shown by the current package exports.
- Do not add Nodemailer for SMTP; Email SDK includes its own SMTP transport.
- SMTP auth on non-secure ports upgrades with STARTTLS by default. Only use `allowInsecureAuth` for trusted local test servers.
- Adapters must either map a normalized `EmailMessage` field or reject it clearly. Never silently drop CC, BCC, reply-to, headers, tags, metadata, or attachments.
- Keep adapter credentials in environment variables.
- Never log API keys, SMTP passwords, raw tokens, full message bodies, or unnecessary recipient data.
- Preserve the host app's architecture for queues, templates, env validation, retries, and tests.

## Integration Pattern

```ts
import { createEmailClient } from "email-sdk";
import { resend } from "email-sdk/resend";
import { smtp } from "email-sdk/smtp";

export const email = createEmailClient({
  adapters: [
    resend({ apiKey: process.env.RESEND_API_KEY! }),
    smtp({
      host: process.env.SMTP_HOST!,
      port: Number(process.env.SMTP_PORT ?? 587),
      auth: {
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
      },
    }),
  ],
  fallback: ["smtp"],
  retry: { retries: 1 },
});
```

## Validation

- For SDK changes, run `bun test` in `packages/email-sdk`.
- For docs changes, run `bun run check-types` and `bun run build` from the repo root when practical.
- For app integrations, run the narrowest test/typecheck that covers the send path.
- For real provider smoke tests, use the CLI with explicit test recipients and do not send external mail without the user's approval.

## Review Checklist

- Does every send include `from`, `to`, `subject`, and either `html` or `text`?
- Are fallbacks configured only for adapters that can send the same class of email?
- Are idempotency keys used for externally visible transactional sends?
- Are provider errors surfaced instead of swallowed?
- Are hooks used for metadata and status, not secret or full-body logging?
- Does each adapter payload have a test when its field mapping changes?
