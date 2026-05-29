---
name: email-sdk
description: Use when adding, reviewing, or documenting Email SDK integrations in TypeScript/Bun apps. Covers adapter selection, provider fallbacks, CLI smoke tests, hooks, and secret-safe email observability.
---

# Email SDK

Use this skill when an agent works with this repository or wires `email-sdk` into another TypeScript app.

## Defaults

- Prefer `bun` and `bunx`.
- Keep the core dependency-free.
- Import adapters from separate entry points: `@opencoredev/email-sdk/resend`, `@opencoredev/email-sdk/smtp`, `@opencoredev/email-sdk/postmark`.
- Do not add Nodemailer for SMTP; Email SDK includes its own SMTP transport.
- SMTP auth on non-secure ports upgrades with STARTTLS by default. Only use `allowInsecureAuth` for trusted local test servers.
- Adapters must either map a normalized `EmailMessage` field or reject it clearly. Never silently drop CC, BCC, reply-to, headers, tags, metadata, or attachments.
- Keep adapter credentials in environment variables.
- Never log API keys, SMTP passwords, raw tokens, full message bodies, or unnecessary recipient data.

## Integration Pattern

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";
import { smtp } from "@opencoredev/email-sdk/smtp";

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
- For release-sensitive changes, run `bun run release:ci`.
- For real provider smoke tests, use the CLI with explicit test recipients and do not send external mail without the user's approval.

## Release Workflow

- The published npm package is `@opencoredev/email-sdk`; the CLI binary remains `email-sdk`.
- User-visible SDK or CLI changes should include a changeset from `bun run changeset`.
- Changesets create random friendly filenames in `.changeset/`; the filename does not need to match the PR name.
- Merging normal feature PRs does not publish. The automated `Version packages` PR is the release button.
- Do not merge `Version packages` for a major version until `docs/release/migrations/vX.md` exists and the major-version agent prompt has been used.
- CI is configured for Depot in `.depot/workflows/ci.yml` with `runs-on: depot-ubuntu-24.04`.
- npm publishing is configured in `.github/workflows/release.yml` on GitHub-hosted runners for npm Trusted Publishing/OIDC. Do not move npm publish to Depot unless npm supports Depot as a trusted publisher.
- Use `docs/release/release-process.md` as the source of truth for publishing and upgrade instructions.

## Review Checklist

- Does every send include `from`, `to`, `subject`, and either `html` or `text`?
- Are fallbacks configured only for adapters that can send the same class of email?
- Are idempotency keys used for externally visible transactional sends?
- Are provider errors surfaced instead of swallowed?
- Are hooks used for metadata and status, not secret or full-body logging?
- Does each adapter payload have a test when its field mapping changes?
