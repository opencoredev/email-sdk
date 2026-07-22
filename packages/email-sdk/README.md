# Email SDK

A server-side TypeScript SDK for transactional email send pipelines. You get one typed client, literal adapter routes, field-support validation before providers drop data, delivery-aware retries and fallback, and plugins for defaults, observability, capture, or custom adapters.

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

The public npm package is `@opencoredev/email-sdk`. The CLI binary it installs is `email-sdk`. Use both from server-side runtimes such as Node.js 20+ or Bun 1.1+, and never expose provider API keys in browser code.

## Quickstart

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
});

const result = await email.send({
  from: "Acme <hello@acme.com>",
  to: "user@example.com",
  subject: "Welcome",
  text: "Your account is ready.",
});

console.log(result.adapter, result.id);
```

## Why use this

- One `EmailMessage` shape across provider APIs.
- Adapter subpath imports, so apps load only the integrations they use.
- Type-inferred route names across `send`, `validate`, `adapter`, and `withAdapter`.
- Capability validation for headers, attachments, tags, metadata, scheduling, and personalization.
- Retries inside one adapter, then fallback only when your fallback policy allows it.
- Sequential `sendMany` for independent sends and `sendPersonalized` for recipient variables.
- Built-in SMTP transport with no Nodemailer dependency.
- Hooks and middleware for logs, metrics, traces, defaults, and capture stores.
- Test adapters that never call a real provider.
- A bundled CLI for adapter discovery, setup checks, and dry-run validation.

## Adapters

Each adapter is exported from its own entry point. Pick the adapter names you want to route through and use `defaultAdapter` when the first registered adapter should not be the default.

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { resend } from "@opencoredev/email-sdk/resend";

const email = createEmailClient({
  adapters: [
    resend({ apiKey: process.env.RESEND_API_KEY! }),
    postmark({ serverToken: process.env.POSTMARK_SERVER_TOKEN!, name: "backup" }),
  ],
  defaultAdapter: "resend",
  fallback: {
    adapters: ["backup"],
    onUnknownDelivery: "stop",
  },
  retry: { maxAttempts: 2 },
});
```

Available adapter entry points:

| Entry point | Adapter |
| --- | --- |
| `@opencoredev/email-sdk/resend` | Resend |
| `@opencoredev/email-sdk/postmark` | Postmark |
| `@opencoredev/email-sdk/sendgrid` | SendGrid |
| `@opencoredev/email-sdk/cloudflare` | Cloudflare Email Sending |
| `@opencoredev/email-sdk/unosend` | Unosend |
| `@opencoredev/email-sdk/ses` | AWS SES |
| `@opencoredev/email-sdk/mailgun` | Mailgun |
| `@opencoredev/email-sdk/mailersend` | MailerSend |
| `@opencoredev/email-sdk/brevo` | Brevo |
| `@opencoredev/email-sdk/mailchimp` | Mailchimp Transactional |
| `@opencoredev/email-sdk/sparkpost` | SparkPost |
| `@opencoredev/email-sdk/iterable` | Iterable |
| `@opencoredev/email-sdk/loops` | Loops |
| `@opencoredev/email-sdk/sequenzy` | Sequenzy |
| `@opencoredev/email-sdk/jetemail` | JetEmail |
| `@opencoredev/email-sdk/lettermint` | Lettermint |
| `@opencoredev/email-sdk/primitive` | Primitive |
| `@opencoredev/email-sdk/plunk` | Plunk |
| `@opencoredev/email-sdk/mailtrap` | Mailtrap |
| `@opencoredev/email-sdk/scaleway` | Scaleway |
| `@opencoredev/email-sdk/zeptomail` | ZeptoMail |
| `@opencoredev/email-sdk/mailpace` | MailPace |
| `@opencoredev/email-sdk/smtp` | SMTP |
| `@opencoredev/email-sdk/testing` | Memory and failing test adapters |

## Message shape

A message requires `from`, `to`, `subject`, and either `text` or `html`. Headers are arrays so repeated names stay explicit, and attachments must use exactly one source: `content` or `path`.

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
    headers: [{ name: "X-App", value: "acme" }],
    tags: [{ name: "kind", value: "receipt" }],
    metadata: { userId: "user_123" },
    attachments: [
      {
        filename: "receipt.txt",
        content: "Order #123",
        contentType: "text/plain",
      },
    ],
  },
  {
    idempotencyKey: "receipt:user_123:order_123",
    metadata: { job: "order-receipt" },
  },
);
```

Adapters reject unsupported fields instead of silently dropping them. For example, SMTP rejects provider-only fields such as tags and metadata, while product-email adapters may reject unsupported address or attachment fields.

## Retries and fallback

Retries happen inside the current adapter. Fallback happens after that adapter has finally failed, and v1 stops by default when the delivery outcome is unknown because a timeout may have happened after provider acceptance.

```ts
const email = createEmailClient({
  adapters: [primary, backup],
  retry: { maxAttempts: 3 },
  fallback: {
    adapters: ["backup"],
    onUnknownDelivery: "stop", // default
  },
});

await email.send(message, {
  adapter: "primary",
  fallback: { adapters: ["backup"] },
  retry: { maxAttempts: 1 },
  idempotencyKey: "receipt:order_123",
});
```

Use fallback only when the backup adapter can represent the same message fields that matter to your app. Set `onUnknownDelivery: "continue"` only when duplicate delivery is acceptable or the provider gives you stronger idempotency than the SDK can prove.

## Sending modes

Use `send` for one message, `sendMany` for sequential independent messages, and `sendPersonalized` when one template is rendered with per-recipient variables.

```ts
await email.sendMany([
  { message: welcomeMessage, options: { idempotencyKey: "welcome:ada" } },
  { message: receiptMessage, options: { idempotencyKey: "receipt:linus:123" } },
]);

await email.sendPersonalized(
  {
    message: {
      from: "Acme <hello@acme.com>",
      subject: "Hi %recipient.name%",
      text: "Welcome, %recipient.name%.",
    },
    recipients: [
      { to: "ada@example.com", variables: { name: "Ada" } },
      { to: "linus@example.com", variables: { name: "Linus" } },
    ],
  },
  { idempotencyKey: "onboarding:2026-07" },
);
```

`sendMany` is ordered and settled. It returns one `{ ok, index, result | error }` item per input and does not run concurrently in v1.

## Plugins

Plugins can register adapters, add middleware, compose hooks, and extend the returned client.

```ts
import { defaultsPlugin } from "@opencoredev/email-sdk/plugins/defaults";
import { observabilityPlugin } from "@opencoredev/email-sdk/plugins/observability";
import { routingPlugin } from "@opencoredev/email-sdk/plugins/routing";
import { timeoutPlugin } from "@opencoredev/email-sdk/plugins/timeout";

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
  plugins: [
    defaultsPlugin({
      headers: [{ name: "X-App", value: "acme" }],
      tags: [{ name: "source", value: "app" }],
      idempotencyKeyPrefix: "acme:",
    }),
    routingPlugin({
      select: ({ message }) => (message.subject.startsWith("Receipt") ? "resend" : undefined),
    }),
    timeoutPlugin({ timeoutMs: 10_000 }),
    observabilityPlugin({
      log(event) {
        console.log(event.type, event.adapter);
      },
    }),
  ],
});
```

Built-in plugin entry points:

| Entry point | Use it for |
| --- | --- |
| `@opencoredev/email-sdk/plugins/defaults` | Default headers, tags, metadata, reply-to, and idempotency keys |
| `@opencoredev/email-sdk/plugins/routing` | Dynamic primary-adapter selection from the prepared message and send metadata |
| `@opencoredev/email-sdk/plugins/timeout` | A whole-logical-send timeout composed with caller cancellation |
| `@opencoredev/email-sdk/plugins/observability` | Redacted logs, metrics, and traces from lifecycle events |
| `@opencoredev/email-sdk/plugins/capture` | In-memory event capture for tests |

## CLI

The package installs the `email-sdk` binary.

```bash
email-sdk adapters
RESEND_API_KEY=re_xxx email-sdk doctor --adapter resend
EMAIL_SDK_TELEMETRY=0 email-sdk send \
  --adapter resend \
  --from "Acme <hello@acme.com>" \
  --to user@example.com \
  --subject "Welcome" \
  --text "Your account is ready." \
  --dry-run
```

`send --dry-run` constructs the adapter, validates the normalized message, and prints the plan without calling the adapter send method.

## React templates

Keep templates in files such as `ui/email/welcome.tsx`, then render and send them through any adapter:

```tsx
import { renderEmail } from "@opencoredev/email-sdk/react";
import { WelcomeEmail } from "./ui/email/welcome";

const content = await renderEmail(<WelcomeEmail name="Ada" />);
await email.send({ from, to, subject: "Welcome", ...content });
```

The optional `/react` subpath also exports email-safe shadcn-themed components such as `ShadcnEmail`, `EmailCard`, and `EmailButton`. They use inline styles instead of browser-only Radix, Tailwind, or CSS-variable behavior.

## AI tools

Import `@opencoredev/email-sdk/ai` only when your app also installs the optional `ai` peer. `createEmailTools` returns one approval-gated `sendEmail` tool whose schema lets the model set only `to`, `subject`, `text`, and `html`; your app binds the sender.

## Testing

Use `@opencoredev/email-sdk/testing` for no-network tests.

```ts
import { createEmailClient, EmailAdapterError } from "@opencoredev/email-sdk";
import { failingAdapter, memoryAdapter } from "@opencoredev/email-sdk/testing";

const primary = failingAdapter(
  "primary",
  new EmailAdapterError("Rejected before acceptance", {
    adapter: "primary",
    delivery: "not_sent",
  }),
);
const backup = memoryAdapter("backup");

const email = createEmailClient({
  adapters: [primary, backup],
  fallback: { adapters: ["backup"] },
  telemetry: false,
});
```

## Migration from 0.x

v1 keeps `createEmailClient` and adapter subpath imports, but the root API uses adapter vocabulary only. Replace provider aliases with adapter names, move `idempotencyKey` into send options, replace `sendBatch` with `sendMany`, replace `recipientVariables` with `sendPersonalized`, and use `retry.maxAttempts` instead of `retry.retries`.

If the migration cannot happen in one change, import from `@opencoredev/email-sdk/compat` temporarily. The bridge translates legacy constructor and send option names, result aliases, message-level idempotency, and recipient variables while keeping v1 unknown-delivery fallback safety.

## Telemetry

Anonymous telemetry is enabled by default for SDK and CLI usage. It records adapter names, command names, success/failure, error codes, duration, recipient counts, whether scheduling was requested, SDK version, runtime, OS, CI metadata, and redacted error shape. It never records email content, subjects, addresses, headers, attachments, API keys, or provider raw responses.

Opt out globally:

```bash
export EMAIL_SDK_TELEMETRY=0
# or
export DO_NOT_TRACK=1
```

Opt out per client:

```ts
const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
  telemetry: false,
});
```

`bun test` disables live telemetry through the package test preload.

## Documentation

- Quickstart: https://email-sdk.dev/docs/getting-started/quickstart
- Field support: https://email-sdk.dev/docs/adapters/field-support
- Fallbacks and retries: https://email-sdk.dev/docs/concepts/fallbacks-and-retries
- v0 to v1 migration: https://email-sdk.dev/docs/guides/migrate/v0-to-v1
