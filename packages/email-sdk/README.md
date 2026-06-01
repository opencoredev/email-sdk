# Email SDK

A lightweight TypeScript SDK for transactional email. Use one typed client, pick the adapters your app actually sends through, and add plugins for defaults, observability, capture, or community providers.

```bash
bun add @opencoredev/email-sdk
```

The public npm package is `@opencoredev/email-sdk`; the unscoped `email-sdk` package is unrelated.
The command-line binary it installs is named `email-sdk`.

Use the SDK from server-side runtimes such as Node 20+ or Bun. Do not expose provider API keys in browser or client-side code. The included CLI requires Bun.

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
| `@opencoredev/email-sdk/cloudflare` | Cloudflare Email Sending         |
| `@opencoredev/email-sdk/ses`        | AWS SES                          |
| `@opencoredev/email-sdk/mailgun`    | Mailgun                          |
| `@opencoredev/email-sdk/mailersend` | MailerSend                       |
| `@opencoredev/email-sdk/brevo`      | Brevo                            |
| `@opencoredev/email-sdk/mailchimp`  | Mailchimp Transactional          |
| `@opencoredev/email-sdk/sparkpost`  | SparkPost                        |
| `@opencoredev/email-sdk/loops`      | Loops                            |
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

The package includes a small Bun CLI:

```bash
# one-off: no install needed
bunx --yes @opencoredev/email-sdk adapters

# after bun add @opencoredev/email-sdk
bun email-sdk adapters
bun email-sdk doctor --adapter resend
bun email-sdk send --adapter resend --from hello@example.com --to user@example.com --subject "Hello" --text "It works"
bun email-sdk send --dry-run --adapter resend --from hello@example.com --to user@example.com --subject "Hello" --text "It works"
```

The CLI can read provider credentials from environment variables or matching credential flags. Run `bun email-sdk adapters` to see the variables each adapter expects. `--dry-run` validates the message and selected adapter field support without sending email.

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
