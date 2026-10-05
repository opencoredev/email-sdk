---
name: test-email-sdk
description: Test, reproduce, or verify changes to the @opencoredev/email-sdk package, its email-sdk CLI, the SMTP transport, provider adapters, or the @opencoredev/convex-email component. Use before reporting any SDK, CLI, adapter, or Convex component change as done.
---

# Test Email SDK

Email SDK is a library plus a CLI. There is no server to launch. "Running the app" means calling the SDK from a script, running the built CLI, and checking what a mail server or provider actually received. A green unit suite is not proof that mail goes out correctly.

## Proof levels

Report which level each claim reached. Never call a lower level a higher one.

1. **Unit**: `bun test` with stubbed `fetch` or a fake socket. This proves request shape and error mapping, not delivery.
2. **Local wire**: a real SMTP server (Mailpit in Docker) receives and parses the message. This proves MIME, encoding, envelope, and CLI behavior with no credentials.
3. **Live auth**: `live:*` scripts probe the real provider. This proves credentials and endpoint, not delivery, and only when the probe reports authenticated. An inconclusive probe (JetEmail's validation-only check, for example) stays NOT CHECKED.
4. **Live send**: a real message sent with `<PROVIDER>_LIVE_SEND=true`. This needs Leo's explicit approval for that send.

## Setup

From the repo root:

```bash
bun install
bun run build   # required before CLI runs, convex-email tests, and the SMTP check
```

`bun test` sets `EMAIL_SDK_TELEMETRY=0` through `packages/email-sdk/test-preload.ts`. When running the built CLI or ad-hoc scripts outside `bun test`, set `EMAIL_SDK_TELEMETRY=0` yourself so you don't send real telemetry.

## Unit level

```bash
cd packages/email-sdk
bun test                        # whole package
bun test src/smtp.test.ts       # one area
bun run check-types             # includes type-tests/
```

Fixtures live in `packages/email-sdk/test-support/`. Use `stubFetch` (`fetch.ts`) for HTTP adapters, and `adapter-fixtures.ts` for a shared `message` and `context`. The public `memoryAdapter` and `failingAdapter` come from `src/testing.ts`. `smtp.test.ts` runs a `net.createServer` fake and asserts on raw SMTP DATA, which is the only place header-level guarantees like "no Bcc header" are checked.

For each adapter change, test the mapped request, a provider error, a retryable versus permanent failure, and any unsupported field the adapter rejects.

## Local wire level (SMTP and CLI)

Required for any change to `src/smtp.ts`, `src/smtp-errors.ts`, MIME or attachment handling, the CLI `send` path, or the `nodemailer` dependency:

```bash
bun scripts/check-smtp-local.ts
```

It needs Docker. It starts its own `axllent/mailpit` container named `email-sdk-smtp-check-<pid>`, bound to random `127.0.0.1` ports. Then it sends one rich message through the SDK (non-ASCII subject, cc/bcc/reply-to, a custom header, a file attachment, an inline `cid:` image, and an idempotency `Message-ID`) and one through `packages/email-sdk/dist/cli.js send`. It reads both back from the Mailpit API, checks headers, bodies, and decoded attachment bytes, prints a JSON check list, and exits non-zero on any failure. It removes only its own container, including on Ctrl+C. It refuses to run if `dist/cli.js` is older than `packages/email-sdk/src`, and the CLI child ignores both inherited `SMTP_*` settings and `.env` files.

- When you change behavior, add a matching assertion to the script. Don't just eyeball the output.
- `KEEP_MAILPIT=1 bun scripts/check-smtp-local.ts` leaves the container up and prints its UI and SMTP ports, so you can inspect `/api/v1/message/<id>/raw`. Remove it afterward with `docker rm -f <printed name>`. Never remove other Mailpit or Postgres containers on this host; other worktrees own them.
- Mailpit prepends a synthetic `Bcc:` header to stored messages, so header absence can only be proven by the unit test.

## CLI without sending

```bash
EMAIL_SDK_TELEMETRY=0 packages/email-sdk/dist/cli.js adapters
EMAIL_SDK_TELEMETRY=0 packages/email-sdk/dist/cli.js send --adapter resend --from a@example.test \
  --to b@example.test --subject Hi --text Hi --dry-run
SMTP_HOST=127.0.0.1 EMAIL_SDK_TELEMETRY=0 packages/email-sdk/dist/cli.js doctor --adapter smtp --json
```

`--dry-run` validates and prints the plan without network access. `doctor` without `--live` makes no provider request. `--base-url` accepts a `127.0.0.1` fixture server for HTTP adapters. CLI output and flags must stay in sync with docs (`bun test scripts/check-cli-doc-consistency.test.ts`).

## Live level

Credentials come from repo-root `.env.local`, then `.env`, then the shell. Never print them or paste them into logs, commits, or PRs.

```bash
bun run live:plan origin/main HEAD   # which registered live gates this diff affects
bun run live:run -- <adapters>       # runs them with every *_LIVE_SEND flag stripped
```

Individual scripts and what each probe does are listed in `adapter-verification.json`. A missing secret is a blocked check; report it as NOT CHECKED, not as a pass. Sending real email (`*_LIVE_SEND=true`) needs Leo's approval for that specific send.

## Convex component

```bash
bun run build                          # email-sdk must be built first
cd packages/convex-email && bun test
```

`bun run codegen` needs a Convex deployment and is maintainer-only.

## Before reporting done

- Run `bun run release:ci` for release-sensitive work. It covers lint policy, types, tests, docs checks, build, and `npm pack --dry-run`. It does not run the SMTP wire check or live gates; run those separately when they apply.
- Lint touched files with `bunx oxlint <path>`. Never disable an anti-slop rule.
- End with PASS / FAIL / NOT CHECKED lines that name the proof level reached.

## Known gaps

- `.launch-smoke/` is stale and not in CI. It imports `EmailProviderError`, which 2.0 no longer exports, so it fails. Don't treat it as a signal until someone repairs it.
- No local fixture exists for HTTP providers beyond unit stubs. Delivery through a provider is only proven at the live-send level.
