# How to Send Email from Node.js and TypeScript

There are three ways to send email from Node.js: over SMTP with [Nodemailer](https://nodemailer.com), with an email provider's HTTP API through `fetch` or the provider's SDK, or through a provider-neutral library that wraps both. SMTP works with any mail server. An HTTP API is faster to set up and gives you provider features such as idempotency keys and webhooks. A provider-neutral library keeps your send code the same when you switch providers or add a fallback.

This guide shows working TypeScript for each, then how to test email code without sending real messages. Every sample was typechecked against `@opencoredev/email-sdk` 3.0.1 and Nodemailer 10.3, and the HTTP and Email SDK samples ran with `bun test` against a stubbed network. No real email was sent.

## Which approach to pick

| | SMTP with Nodemailer | Provider HTTP API | Email SDK |
| --- | --- | --- | --- |
| Works with | Any SMTP server | One provider | 26 provider APIs plus SMTP |
| Setup | Host, port, username, password | API key | API key or SMTP settings |
| Idempotent retries | No | Depends on provider | Uses the provider's key where it has one |
| Switching providers | Change SMTP settings | Rewrite the send code | Change the adapter |
| Fallback provider | Write it yourself | Write it yourself | Built in, opt-in |
| Tests without sending | Nodemailer's test transports | Mock `fetch` | `memoryAdapter` |

Whichever you pick, send from the server. An API key or SMTP password in a browser bundle lets anyone send mail as your domain. Before the first send, verify your sending domain with the provider and check that SPF, DKIM and DMARC resolve. The [email DNS checker](/tools/email-dns-checker) does that for any domain.

## Option 1: SMTP with Nodemailer

Nodemailer is the standard SMTP client for Node.js. Install it with its types:

```bash
npm install nodemailer
npm install --save-dev @types/nodemailer
```

Create one transport and reuse it. Port 587 with `secure: false` connects in plain text and upgrades with STARTTLS. Use port 465 with `secure: true` for TLS from the first byte.

`send-smtp.ts`:

```ts
import nodemailer from "nodemailer";

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

const info = await transporter.sendMail({
  from: '"Acme" <hello@acme.com>',
  to: "ada@example.com",
  subject: "Welcome to Acme",
  text: "Thanks for signing up.",
  html: "<p>Thanks for signing up.</p>",
});

console.log("Sent", info.messageId);
```

SMTP is the right choice for a self-hosted mail server, a mailbox provider, or a provider whose SMTP relay you already use. The trade-offs: each send holds a connection open for several round trips, a timeout leaves you unsure whether the server accepted the message, and there's no idempotency key to make a retry safe. [Nodemailer's SMTP docs](https://nodemailer.com/smtp) cover pooling, OAuth2 and DKIM signing.

## Option 2: a provider's HTTP API

Transactional email providers such as Resend, Postmark, SendGrid, Mailgun and Amazon SES accept a JSON or form request over HTTPS. Node.js 18 and later ship `fetch`, so you don't need a dependency. This example sends through Resend:

`send-http.ts`:

```ts
const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) throw new Error("Set RESEND_API_KEY.");

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Idempotency-Key": "welcome-email/user_123",
  },
  body: JSON.stringify({
    from: "Acme <hello@acme.com>",
    to: ["ada@example.com"],
    subject: "Welcome to Acme",
    text: "Thanks for signing up.",
    html: "<p>Thanks for signing up.</p>",
  }),
});

if (!response.ok) {
  throw new Error(`Resend returned ${response.status}: ${await response.text()}`);
}

const { id } = (await response.json()) as { id: string };

console.log("Sent", id);
```

The `Idempotency-Key` header means a retry with the same key can't send the email twice. Each provider names its fields differently, though: Postmark wants `From`, `To` and `HtmlBody`, Mailgun takes multipart form fields, and SES signs requests with AWS Signature Version 4. Code written against one API is a rewrite for the next. The provider guides walk through each API in full: [Resend](/blog/resend-api-nodejs-typescript) and [Mailgun](/blog/mailgun-api-nodejs-typescript).

## Option 3: one client for any provider

[Email SDK](/docs) is an open-source TypeScript library with one message shape and an adapter per provider. Its SMTP adapter runs on Nodemailer, so you keep Nodemailer for SMTP and get the same API for providers' HTTP APIs. It runs on Node.js 20+ and Bun 1.1+, server-side only.

```bash
npm install @opencoredev/email-sdk
```

Create the client once. This one picks Resend in production and SMTP everywhere else, and the code that sends doesn't care which:

`email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";
import { smtp } from "@opencoredev/email-sdk/smtp";

const provider =
  process.env.NODE_ENV === "production"
    ? resend({ apiKey: process.env.RESEND_API_KEY! })
    : smtp({
        host: process.env.SMTP_HOST!,
        port: 587,
        auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
      });

export const email = createEmailClient({ adapters: [provider] });
```

`send-welcome.ts`:

```ts
import { email } from "./email";

export async function sendWelcomeEmail(userId: string, to: string) {
  const result = await email.send(
    {
      from: "Acme <hello@acme.com>",
      to,
      subject: "Welcome to Acme",
      text: "Thanks for signing up.",
      html: "<p>Thanks for signing up.</p>",
    },
    { idempotencyKey: `welcome-email/${userId}` },
  );

  return { provider: result.adapter, id: result.id };
}
```

Moving from Resend to Postmark, SES or any other supported provider means changing the adapter in `email.ts`. Every adapter checks the message before it sends, so a field the new provider can't carry fails with an `EmailValidationError` instead of disappearing. The [field support table](/docs/adapters/field-support) lists what each provider accepts.

### Add a fallback provider

List a second adapter and name it as the fallback:

`email-fallback.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { resend } from "@opencoredev/email-sdk/resend";

export const email = createEmailClient({
  adapters: [
    resend({ apiKey: process.env.RESEND_API_KEY! }),
    postmark({ serverToken: process.env.POSTMARK_SERVER_TOKEN! }),
  ],
  defaultAdapter: "resend",
  retry: { maxAttempts: 3 },
  fallback: { adapters: ["postmark"], onUnknownDelivery: "continue" },
});
```

How it behaves: the client tries Resend up to three times with the same idempotency key. If Resend still fails, the fallback depends on whether Resend might have accepted the message. HTTP adapters report every failed request, an HTTP error or a network error, as delivery `"unknown"`, because a timeout can't prove the provider didn't accept it. The default, `onUnknownDelivery: "stop"`, throws an `EmailRouteError` and never calls Postmark. Setting it to `"continue"`, as above, sends through Postmark anyway and accepts that the recipient might get two copies. [Retries and fallback](/docs/concepts/fallbacks-and-retries) explains the choice.

## Test without sending real email

Tests that send real email are slow, flaky, and spend provider quota. Email SDK's `memoryAdapter` records messages instead:

`welcome.test.ts`:

```ts
import { expect, test } from "bun:test";

import { createEmailClient } from "@opencoredev/email-sdk";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";

test("signup sends one welcome email", async () => {
  const memory = memoryAdapter();
  const email = createEmailClient({ adapters: [memory] });

  await email.send({
    from: "Acme <hello@acme.com>",
    to: "ada@example.com",
    subject: "Welcome to Acme",
    text: "Thanks for signing up.",
  });

  expect(memory.raw?.sent).toHaveLength(1);
  expect(memory.raw?.sent[0]?.message.to).toBe("ada@example.com");
});
```

With plain Nodemailer, `nodemailer.createTransport({ jsonTransport: true })` returns the message as JSON without connecting anywhere, and [Ethereal](https://ethereal.email) gives you a throwaway SMTP inbox to look at the rendered email. [Test email behavior](/docs/guides/test-email-behavior) covers failure cases with Email SDK.

## Checklist before production

- Verify the sending domain with your provider, and publish SPF, DKIM and DMARC records.
- Keep keys in environment variables or a secret manager, on the server only.
- Send an idempotency key with every send that might be retried, such as from a queue or a webhook handler.
- Store the provider's message ID with the record that triggered the email, so you can match bounce and delivery webhooks to it.
- Handle bounces and complaints: stop sending to addresses that hard-bounce.
- Send a plain text part alongside HTML.

## Related

- [Quickstart](/docs/getting-started/quickstart): install Email SDK and send a first email.
- [Migrate from Nodemailer](/docs/guides/migrate/nodemailer): move existing Nodemailer code to Email SDK and keep SMTP.
- [SMTP adapter reference](/docs/adapters/smtp): host, port, TLS and authentication options.
- [Resend API guide](/blog/resend-api-nodejs-typescript) and [Mailgun API guide](/blog/mailgun-api-nodejs-typescript): raw HTTP API walkthroughs.
- [Compare email providers](/compare): field support and code for each provider pair.
