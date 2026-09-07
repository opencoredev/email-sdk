# First send: standalone Resend starter

A private ESM project that runs on Node.js 20+ or Bun 1.1+ with only two dependencies: `@opencoredev/email-sdk` and `dotenv`. Copy the whole directory anywhere outside this repository. It uses plain `.mjs`, so there is no TypeScript build step, and it only needs a Resend account.

Two commands:

| Command | What it does | Contacts Resend? |
| --- | --- | --- |
| `npm run validate` (default) | Loads `.env`, builds the message, runs `email.validate` | No |
| `npm run send` | Same, then `email.send` once | Yes, one `POST /emails` |

## 1. Install

```bash
cp -r path/to/email-sdk/packages/email-sdk/examples/first-send ~/first-send
cd ~/first-send
npm install          # or: bun install
cp .env.example .env
```

## 2. Validate (no email sent)

```bash
npm run validate
# Bun: bun --no-env-file first-send.mjs
```

Expected output:

```json
{
  "ok": true,
  "mode": "validate",
  "adapter": "resend",
  "sent": false
}
```

This works with the placeholder values from `.env.example`. `email.validate` checks the message shape (sender, recipient, subject, body) and the adapter's field support locally; it does not authenticate the key, check domain verification, or prove delivery. No request is made to Resend.

## 3. Configure the environment

`first-send.mjs` loads `.env.local`, then `.env`, from its own directory, without overriding variables that already exist in the process: **process environment > `.env.local` > `.env`**. Neither the SDK nor the CLI reads these files; the starter does it explicitly with `dotenv`. Bun also preloads `.env` on its own before the script runs, so use `bun --no-env-file first-send.mjs` if you want the starter's loader to be the only one.

| Variable | Value |
| --- | --- |
| `RESEND_API_KEY` | A Resend API key with sending permission. Keep it server-side. |
| `EMAIL_FROM` | A sender on a domain verified in Resend, for example `Acme <hello@updates.acme.com>`. |
| `EMAIL_TO` | A recipient you control. |

`.env` and `.env.local` are git-ignored; commit only `.env.example`.

### Resend domain verification and test-account limits

- Resend sends from domains you own. You must [add and verify at least one domain](https://resend.com/docs/dashboard/domains/introduction) before sending from your own address.
- Resend's shared `onboarding@resend.dev` sender is for testing only and can send **only to the email address associated with your Resend account**. Sending to anyone else returns HTTP 403 `You can only send testing emails to your own email address (...)`. See [403 Error Using resend.dev Domain](https://resend.com/docs/knowledge-base/403-error-resend-dev-domain) and the [Resend error reference](https://resend.com/docs/api-reference/errors).
- Free plans have daily and monthly quotas (HTTP 429 `daily_quota_exceeded` / `monthly_quota_exceeded`).
- Resend offers `delivered@resend.dev`, `bounced@resend.dev`, and `complained@resend.dev` as [test recipients](https://resend.com/docs/dashboard/emails/send-test-emails) that simulate outcomes without reaching a real inbox.

## 4. Authenticate with `doctor` (no email sent)

The CLI does not load `.env`. Export the values into your shell first (for example `set -a; . ./.env; set +a`), then:

```bash
# Configuration only: confirms RESEND_API_KEY is present. No network.
npm exec --package=@opencoredev/email-sdk -- email-sdk doctor --adapter resend

# Live: authenticates the key and checks the EMAIL_FROM domain in Resend. Still no email.
npm exec --package=@opencoredev/email-sdk -- email-sdk doctor --adapter resend --live --from "$EMAIL_FROM" --json
```

The scoped package name matters: the unscoped `email-sdk` package on npm is unrelated. Because `npm install` already put the binary in `node_modules/.bin`, `./node_modules/.bin/email-sdk doctor --adapter resend` is equivalent. With Bun: `bunx --package @opencoredev/email-sdk email-sdk doctor --adapter resend`.

Default `doctor` prints `resend looks configured.` when the variable is set. `--live` reports per-check statuses; a send-only key may authenticate but be denied the read access `--from` needs (`restricted_api_key`), which does not mean it cannot send. See the [doctor reference](https://email-sdk.dev/docs/reference/cli/doctor).

## 5. Send one email (explicit)

```bash
npm run send
# Bun: bun --no-env-file first-send.mjs --send
```

**This sends a real email.** `--send` is the only way to reach `email.send`. Before contacting Resend the script refuses if:

- `EMAIL_FROM` or `EMAIL_TO` is missing or empty;
- `RESEND_API_KEY` is missing, does not start with `re_`, or is still the `.env.example` placeholder;
- either address uses a reserved test domain (`example.com/net/org`, or a `.test`, `.example`, `.invalid`, `.localhost` TLD).

Expected output:

```json
{
  "ok": true,
  "mode": "send",
  "adapter": "resend",
  "id": "49a3999c-0ce1-4ea6-ab68-afcd6dc2e794",
  "receipt": "accepted by provider; inbox delivery not confirmed"
}
```

`id` is Resend's message id. It means Resend **accepted** the request; it does not mean the message reached an inbox. Delivery, bounces, and complaints show up later in the Resend dashboard or through [webhooks](https://email-sdk.dev/docs/reference/webhooks). If the command times out, check the dashboard before retrying so you do not send twice.

## Telemetry

The SDK sends anonymous usage telemetry by default (adapter names, success/failure counts, redacted errors; never addresses, content, or keys). The starter awaits `email.flush()` in a `finally` block so pending events are delivered before the process exits, on success and on failure. To opt out, set `EMAIL_SDK_TELEMETRY=0` or `DO_NOT_TRACK=1` in the environment (or in `.env`), or pass `telemetry: false` to `createEmailClient` in your own code. With telemetry off, `npm run validate` makes no network requests at all.

## Likely errors

| Output | Meaning |
| --- | --- |
| `ERR_MODULE_NOT_FOUND` | Run `npm install` in this directory; Node must be 20 or newer. |
| `Set EMAIL_FROM and EMAIL_TO ... before --send.` | One or both addresses are missing. Nothing was sent. |
| `Set a real server-only RESEND_API_KEY ...` | The key is missing or still the placeholder. Nothing was sent. |
| `Replace example addresses ...` | `EMAIL_FROM`/`EMAIL_TO` still use reserved example/test domains. Nothing was sent. |
| `Set EMAIL_FROM and EMAIL_TO to one valid mailbox each.` | An address is not `user@domain` or `Name <user@domain>`. |
| `validation_error: ...` | The SDK rejected the message locally (missing subject/body, unsupported field). |
| `route_error: All configured email adapters failed. <- adapter_error: Resend failed with 401: ...` | The API key is invalid or missing. |
| `... <- adapter_error: Resend failed with 403: You can only send testing emails to your own email address (...)` | You are sending from `onboarding@resend.dev` to an address other than your account email. Verify a domain. |
| `... <- adapter_error: Resend failed with 403: The ... domain is not verified` | `EMAIL_FROM` uses a domain not verified in Resend. |
| `... <- adapter_error: Resend failed with 422: ...` | Resend rejected a field; the message names it. |
| `... <- adapter_error: Resend failed with 429: ...` | Rate limit or plan quota. Wait, then retry once. |

Errors exit with status 1. The SDK reports a single-adapter send failure as `route_error` wrapping the `adapter_error`; the starter prints both. Output contains the SDK error code and Resend's message, never the API key.

## Offline integration check

```bash
EMAIL_SDK_TELEMETRY=0 npm test
# Bun: EMAIL_SDK_TELEMETRY=0 bun test ./first-send.check.mjs
```

`first-send.check.mjs` proves, without credentials or network access to Resend, that:

- the default command validates and makes no transport call;
- `--send` refuses when `EMAIL_FROM`/`EMAIL_TO` are missing, when the key is a placeholder, and when addresses are example domains;
- the refusal exit code is 1 and the key never appears in output;
- an explicit send posts exactly once to a temporary `127.0.0.1` HTTP server that mimics Resend's `POST /emails` and returns `{"id":"fixture-id"}`, and a 403 from that server surfaces as `adapter_error`.

The fixture is import-only: tests pass a `fixture` object to `run()`. No CLI flag or environment variable can point the real command at another host.

## Next step

For routing with fallback adapters, batch and personalized sends, scheduling, idempotency keys, and React templates, continue with [examples/v1-server](../v1-server). The prose walkthrough of this starter is the [quickstart](https://email-sdk.dev/docs/getting-started/quickstart).
