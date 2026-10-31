# Resend SMTP Settings and Nodemailer Setup for Node.js

Resend's SMTP server is `smtp.resend.com`. The username is always `resend` and the password is a Resend API key. Use port 465 for TLS from the first byte, or port 587 to connect in plain text and upgrade with STARTTLS. If your host blocks those ports, Resend also listens on 2465 and 2587.

This guide covers those settings, a working Nodemailer setup in TypeScript, the Resend-specific headers that work over SMTP, the errors you're likely to hit, and when to use the HTTP API instead. Settings come from [Resend's SMTP docs](https://resend.com/docs/send-with-smtp), checked October 2026. The code samples typecheck against Nodemailer 10.3 and `@opencoredev/email-sdk` 3.0.1, and the Email SDK behavior described below was checked with `bun test` against a local SMTP server and a stubbed `fetch`. No real email was sent.

## Resend SMTP settings

| Setting | Value |
| --- | --- |
| Host | `smtp.resend.com` |
| Username | `resend` |
| Password | A Resend API key (`re_...`) |
| Implicit TLS (SMTPS) | Port `465` or `2465` |
| STARTTLS | Port `25`, `587` or `2587` |

Before the first send you need a [verified domain](https://resend.com/docs/add-a-domain) in Resend, and the `from` address must be on it. Check the domain's SPF, DKIM and DMARC records with the [email DNS checker](/tools/email-dns-checker).

Create a key with **Sending access** for SMTP. A `sending_access` key can send email but can't read, change or delete other resources in your account, so a leaked SMTP password does less damage than a full-access key. You can also restrict a key to one domain.

## Send with Nodemailer

Install Nodemailer and its types:

```bash
npm install nodemailer
npm install --save-dev @types/nodemailer
```

`resend-smtp.ts`:

```ts
import nodemailer from "nodemailer";

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) throw new Error("Set RESEND_API_KEY.");

export const transporter = nodemailer.createTransport({
  host: "smtp.resend.com",
  port: 465,
  secure: true,
  auth: { user: "resend", pass: apiKey },
});

const info = await transporter.sendMail({
  from: "Acme <hello@acme.com>",
  to: "delivered@resend.dev",
  subject: "Welcome to Acme",
  text: "Thanks for signing up.",
  html: "<p>Thanks for signing up.</p>",
});

console.log("Sent", info.messageId);
```

To use STARTTLS instead, set `port: 587` and `secure: false`, and add `requireTLS: true` so Nodemailer refuses to send your API key if the upgrade to TLS fails. Create the transport once and reuse it. Each `sendMail` call still makes several round trips to the server.

`delivered@resend.dev` is one of Resend's [test addresses](https://resend.com/docs/dashboard/emails/send-test-emails). It accepts the message without touching a real inbox, and `bounced@resend.dev` returns an SMTP `550 5.1.1` so you can test bounce handling. Test sends still count against your quota.

To check the host, port and key without sending anything, call `await transporter.verify()`. It connects, negotiates TLS and logs in, then disconnects.

## Idempotency keys and custom headers over SMTP

SMTP has no idempotency key of its own, so a timeout leaves you unsure whether the message went out, and a blind retry can send it twice. Resend reads a `Resend-Idempotency-Key` header on SMTP messages and won't send a second email with the same key ([idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys)). Nodemailer passes it through `headers`:

`send-welcome-smtp.ts`:

```ts
import { transporter } from "./resend-smtp";

export async function sendWelcome(userId: string, to: string) {
  return transporter.sendMail({
    from: "Acme <hello@acme.com>",
    to,
    subject: "Welcome to Acme",
    text: "Thanks for signing up.",
    headers: {
      "Resend-Idempotency-Key": `welcome-email/${userId}`,
      "X-Entity-Ref-ID": userId,
    },
  });
}
```

Use a key that names the email and the thing that triggered it, so the same event always produces the same key. Resend's docs mention two other headers that are useful here: `X-Entity-Ref-ID` keeps Gmail from threading unrelated emails together, and `List-Unsubscribe` gives recipients a one-click unsubscribe.

## Limits and logs

- The rate limit is the same as the API's: 10 requests per second per team by default, shared by every key ([rate limit](https://resend.com/docs/api-reference/introduction#rate-limit)). Resend can raise it for trusted senders.
- Your plan's daily and monthly quotas apply too. The [Resend pricing breakdown](/blog/resend-pricing) lists them per plan.
- Messages sent over SMTP show up in the Resend dashboard's emails table, like API sends.
- Resend doesn't provide SMTP server logs. To debug a connection, turn on Nodemailer's `logger: true` and `debug: true` transport options, which print the SMTP conversation to your console. Turn them off afterwards, because the log includes message content.

## Common errors

| Error | Likely cause |
| --- | --- |
| `EAUTH` / `535` | The username isn't `resend`, or the password isn't a valid API key |
| `ETIMEDOUT` or `ECONNECTION` | Your host or network blocks the port. Try 2465 or 2587 |
| A timeout or `wrong version number` right after connecting | `secure` doesn't match the port: `true` for 465 and 2465, `false` for 25, 587 and 2587 |
| The `from` address is rejected | The domain isn't verified in Resend, or the address is on another domain |
| `bounced@resend.dev` returns `550 5.1.1` | Expected: that address simulates a hard bounce |

Nodemailer puts the SMTP reply code on `error.responseCode` and its own code on `error.code`. A 4xx reply is temporary and worth retrying after a pause. A 5xx reply is permanent, so fix the message or the account before trying again.

## Resend SMTP or the Resend API

Use SMTP when the software you're connecting only speaks SMTP: Supabase Auth, WordPress, a framework's built-in mailer, or an app that already runs on Nodemailer and you don't want to touch. Changing four settings is the whole migration.

For new Node.js code, the HTTP API is usually simpler. One HTTPS request sends the email and returns its ID, which you need to match delivery and bounce webhooks to the message. The API also covers batch sends of up to 100 emails, scheduled sends, attachments and tags, all with `fetch` and no dependency. The [Resend API guide for Node.js](/blog/resend-api-nodejs-typescript) walks through each.

## Switch between SMTP and the API without rewriting

[Email SDK](/docs) is an open-source TypeScript library with one message shape and an adapter per provider. Its [SMTP adapter](/docs/adapters/smtp) runs on Nodemailer, and its [Resend adapter](/docs/adapters/resend) calls the HTTP API, so moving between the two is a change to one file. It runs on Node.js 20+ and Bun 1.1+, server-side only.

```bash
npm install @opencoredev/email-sdk
```

`email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";
import { smtp } from "@opencoredev/email-sdk/smtp";

const apiKey = process.env.RESEND_API_KEY!;

const provider =
  process.env.RESEND_TRANSPORT === "smtp"
    ? smtp({
        host: "smtp.resend.com",
        port: 465,
        auth: { user: "resend", pass: apiKey },
      })
    : resend({ apiKey });

export const email = createEmailClient({ adapters: [provider] });
```

`send-welcome.ts`:

```ts
import { email } from "./email";

export async function sendWelcome(userId: string, to: string) {
  const key = `welcome-email/${userId}`;

  return email.send(
    {
      from: "Acme <hello@acme.com>",
      to,
      subject: "Welcome to Acme",
      text: "Thanks for signing up.",
      headers: [{ name: "Resend-Idempotency-Key", value: key }],
    },
    { idempotencyKey: key },
  );
}
```

A few things the SMTP adapter does that are worth knowing:

- Port 465 turns on implicit TLS by itself. For 2465, set `secure: true`. Other ports use STARTTLS, and when you pass `auth` the adapter requires the upgrade, so it never sends the key in plain text.
- It opens a connection for each send and closes it afterwards, with a 15-second timeout (`timeoutMs`).
- The `idempotencyKey` option becomes the message's `Message-ID`. Resend reads its own header for deduplication, which is why `send-welcome.ts` sets `Resend-Idempotency-Key` as well. The Resend adapter sends the key in the API's `Idempotency-Key` header.
- When the server answers with an SMTP error code, the adapter reports the message as not sent. It retries a 4xx reply and gives up on a 5xx. When the connection drops or times out mid-send, it reports delivery as `"unknown"`, and by default a fallback provider isn't tried for unknown deliveries. [Retries and fallback](/docs/concepts/fallbacks-and-retries) explains why.

Tests can swap in `memoryAdapter` from `@opencoredev/email-sdk/testing` and assert on what would have been sent. [How to send email from Node.js](/blog/send-email-nodejs-typescript) shows that, plus adding a second provider as a fallback.

## Related

- [Resend API guide for Node.js and TypeScript](/blog/resend-api-nodejs-typescript): the HTTP API with `fetch`, from keys to webhooks.
- [Resend pricing](/blog/resend-pricing): plans, daily caps and overage.
- [How to send email from Node.js and TypeScript](/blog/send-email-nodejs-typescript): SMTP, HTTP APIs and one client for any provider.
- [Resend adapter](/docs/adapters/resend) and [SMTP adapter](/docs/adapters/smtp) reference.
- [Compare Resend with other providers](/compare/resend-vs-postmark).
