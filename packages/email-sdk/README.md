# Email SDK

A lightweight TypeScript SDK for transactional email send pipelines. Use one typed client, pick the adapters your app actually sends through, validate provider compatibility before data is silently dropped, add retries and fallback routes, and use plugins for defaults, observability, capture, or community providers.

Docs: https://email-sdk.dev/docs

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
The command-line binary it installs is named `email-sdk`.

Use the SDK and CLI from server-side runtimes such as Node 20+ or Bun. Do not expose provider API keys in browser or client-side code.

## Quickstart

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

## Why Use This

- One `EmailMessage` shape across providers.
- Provider adapters that map supported fields and reject unsupported fields before the request.
- Fallbacks and retries for production delivery.
- Built-in SMTP transport with no Nodemailer dependency.
- Hooks for send, retry, success, and error observability.
- Plugins for adapter registration, message defaults, middleware, and typed client extensions.
- Test helpers that let app tests capture sends without reaching a real provider.

## Adapters

Each adapter is exported from its own entry point so apps only import what they use.

If you are choosing a first adapter, start with Resend for the shortest setup path. Use Iterable or Sequenzy for product-led transactional sends. Use Postmark, SendGrid, AWS SES, Mailgun, Cloudflare, Unosend, or Brevo when your app needs broader provider-specific controls. Use SMTP when you already have a trusted SMTP service and only need address fields, headers, and plain message delivery.

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

Available adapter entry points:

| Entry point                         | Adapter                          |
| ----------------------------------- | -------------------------------- |
| `@opencoredev/email-sdk/resend`     | Resend                           |
| `@opencoredev/email-sdk/postmark`   | Postmark                         |
| `@opencoredev/email-sdk/sendgrid`   | SendGrid                         |
| `@opencoredev/email-sdk/unosend`    | Unosend                          |
| `@opencoredev/email-sdk/cloudflare` | Cloudflare Email Sending         |
| `@opencoredev/email-sdk/ses`        | AWS SES                          |
| `@opencoredev/email-sdk/mailgun`    | Mailgun                          |
| `@opencoredev/email-sdk/mailersend` | MailerSend                       |
| `@opencoredev/email-sdk/brevo`      | Brevo                            |
| `@opencoredev/email-sdk/mailchimp`  | Mailchimp Transactional          |
| `@opencoredev/email-sdk/sparkpost`  | SparkPost                        |
| `@opencoredev/email-sdk/iterable`   | Iterable                         |
| `@opencoredev/email-sdk/loops`      | Loops                            |
| `@opencoredev/email-sdk/sequenzy`   | Sequenzy                         |
| `@opencoredev/email-sdk/plunk`      | Plunk                            |
| `@opencoredev/email-sdk/mailtrap`   | Mailtrap                         |
| `@opencoredev/email-sdk/scaleway`   | Scaleway                         |
| `@opencoredev/email-sdk/zeptomail`  | ZeptoMail                        |
| `@opencoredev/email-sdk/mailpace`   | MailPace                         |
| `@opencoredev/email-sdk/smtp`       | SMTP                             |
| `@opencoredev/email-sdk/testing`    | Memory and failing test adapters |

SMTP is built in and does not require Nodemailer.

## Message Shape

```ts
await email.send(
  {
    from: "Acme <hello@acme.com>",
    to: [{ email: "user@example.com", name: "Ada" }],
    cc: "team@example.com",
    replyTo: "support@acme.com",
    subject: "Receipt",
    html: "<p>Thanks for your order.</p>",
    text: "Thanks for your order.",
    headers: {
      "X-App": "acme",
    },
    tags: [{ name: "kind", value: "receipt" }],
    metadata: {
      userId: "user_123",
    },
    attachments: [
      {
        filename: "receipt.txt",
        content: "Order #123",
        contentType: "text/plain",
      },
    ],
  },
  {
    idempotencyKey: "receipt_user_123_order_123",
    metadata: {
      job: "order-receipt",
    },
  },
);
```

Adapters keep data handling explicit. If a provider cannot represent a field, Email SDK throws a validation error instead of silently dropping that field. For example, SMTP rejects provider-only fields such as tags and metadata, and narrow product-email adapters reject unsupported addressing or attachment fields.

Attachment `content` is treated as raw content by default. If you already have Base64 content, set `contentEncoding: "base64"`.

## Fallbacks And Retries

```ts
import { smtp } from "@opencoredev/email-sdk/smtp";

const email = createEmailClient({
  adapters: [
    resend({ apiKey: process.env.RESEND_API_KEY! }),
    smtp({
      host: process.env.SMTP_HOST!,
      auth: {
        user: process.env.SMTP_USER!,
        pass: process.env.SMTP_PASS!,
      },
    }),
  ],
  defaultAdapter: "resend",
  fallback: ["smtp"],
  retry: {
    retries: 2,
  },
});
```

Per-send routing is also supported:

```ts
await email.send(message, {
  adapter: "smtp",
  retries: 0,
});
```

Retries happen inside the current adapter. Fallback happens after that adapter has finally failed. For one send, Email SDK validates the normalized message, tries the selected adapter, retries it when retry rules allow it, advances to each configured fallback adapter after final failure, returns the first successful response, and throws if every route fails.

Use fallback routes only when the backup adapter can represent the same message fields that matter to your app. SMTP is a good backup for simple text/html sends with address fields and headers, but not for attachments, tags, or metadata.

Override fallback for one send with `fallbackAdapters`:

```ts
await email.send(message, {
  adapter: "resend",
  fallbackAdapters: ["smtp"],
});
```

Disable fallback for one send with an empty list:

```ts
await email.send(message, {
  adapter: "resend",
  fallbackAdapters: [],
});
```

Use an idempotency key for externally visible email that may be retried or sent through a fallback route:

```ts
await email.send(message, {
  idempotencyKey: "receipt:order_123",
});
```

Read the full route guidance in the public docs:

- https://email-sdk.dev/docs/guides/production-send-pipeline
- https://email-sdk.dev/docs/concepts/fallbacks-and-retries
- https://email-sdk.dev/docs/adapters/field-support

## Plugins

Plugins can register adapters, add middleware, compose hooks, and extend the returned client.

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { defaultsPlugin } from "@opencoredev/email-sdk/plugins/defaults";
import { observabilityPlugin } from "@opencoredev/email-sdk/plugins/observability";
import { resend } from "@opencoredev/email-sdk/resend";

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
  plugins: [
    defaultsPlugin({
      headers: { "X-App": "acme" },
      tags: [{ name: "source", value: "app" }],
      idempotencyKeyPrefix: "acme_",
    }),
    observabilityPlugin({
      log(event) {
        console.log(event.type, event.provider);
      },
    }),
  ],
});
```

Built-in plugin entry points:

| Entry point                                    | Use it for                                                           |
| ---------------------------------------------- | -------------------------------------------------------------------- |
| `@opencoredev/email-sdk/plugins/defaults`      | Default headers, tags, metadata, reply-to, and idempotency keys      |
| `@opencoredev/email-sdk/plugins/observability` | Redacted log, metric, or trace callbacks                             |
| `@opencoredev/email-sdk/plugins/capture`       | Test-only capture of attempted sends, retries, responses, and errors |

Adapter-only plugins are useful for community providers:

```ts
import type { EmailPlugin, EmailProvider } from "@opencoredev/email-sdk";

export function communityMail(options: { apiKey: string }): EmailPlugin {
  const provider: EmailProvider = {
    name: "community-mail",
    async send(message) {
      return {
        provider: "community-mail",
        id: "provider_message_id",
      };
    },
  };

  return {
    id: "community-mail",
    adapters: [provider],
  };
}
```

```ts
const email = createEmailClient({
  plugins: [communityMail({ apiKey: process.env.COMMUNITY_MAIL_API_KEY! })],
});
```

Plugin order is deterministic: direct adapters register first, plugins run in array order, plugin hooks run before user hooks, and user `hooks` remain supported.

## Testing

Use the memory adapter for unit tests:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { capturePlugin } from "@opencoredev/email-sdk/plugins/capture";
import { memoryProvider } from "@opencoredev/email-sdk/testing";

const memory = memoryProvider();
const email = createEmailClient({
  adapters: [memory],
  plugins: [capturePlugin()],
});

await email.send({
  from: "test@example.com",
  to: "user@example.com",
  subject: "Test",
  text: "Hello",
});

console.log(memory.raw.sent);
console.log(email.capture.events);
```

Multiple capture stores can be mounted with custom client keys:

```ts
const email = createEmailClient({
  adapters: [memoryProvider()],
  plugins: [
    capturePlugin({ id: "capture:primary", clientKey: "primaryCapture" }),
    capturePlugin({ id: "capture:audit", clientKey: "auditCapture" }),
  ],
});

email.primaryCapture.clear();
email.auditCapture.clear();
```

## CLI

The package includes a small CLI:

```bash
# one-off: no install needed
bunx --bun --package @opencoredev/email-sdk email-sdk adapters

# after installing @opencoredev/email-sdk
npx email-sdk adapters
RESEND_API_KEY="re_..." npx email-sdk doctor --adapter resend
RESEND_API_KEY="re_..." npx email-sdk send --adapter resend --from hello@example.com --to user@example.com --subject "Hello" --text "It works"
npx email-sdk send --dry-run --adapter resend --from hello@example.com --to user@example.com --subject "Hello" --text "It works"
```

The CLI can read provider credentials from environment variables or matching credential flags. Run `bunx --bun --package @opencoredev/email-sdk email-sdk adapters` for a one-off adapter list, or `npx email-sdk adapters` after installing the scoped package in a project. `--dry-run` validates the message and selected adapter field support without sending email.

## Provider Reality

Email providers differ in domain verification, sandbox modes, rate limits, region settings, API scopes, and field support. Email SDK tests the normalized payloads and fail-fast validation locally, but the final live send still depends on provider account configuration.

For production, start with one primary API adapter, add one fallback adapter, and run a real smoke send from your app environment before relying on the path.

## Development

```bash
bun install
bun test
bun run check-types
bun run build
```

The package is dependency-free at runtime. Keep provider integrations in separate entry points and keep unsupported fields explicit.
