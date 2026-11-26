---
title: "Postmark Alternatives in 2026: 5 Email APIs and How to Switch"
description: "Postmark alternatives in 2026: Resend, SendGrid, Mailgun, Amazon SES and Lettermint by price and message fields, plus a TypeScript switch with Postmark as the fallback."
type: blog
date: 2026-11-26
lastModified: 2026-11-26
search:
  tags: ["Postmark", "Migration", "TypeScript"]
---

Stay on Postmark if you send under 10,000 emails a month on a paid plan, want 45 days of history by default, and need per-message metadata. Switch when you want a free tier above 100 emails a month, scheduled sends, more than one tag per message, or idempotency keys the provider enforces.

The five Postmark alternatives compared here are Resend, SendGrid, Mailgun, Amazon SES and Lettermint. Resend has the largest free tier and native idempotency keys, SendGrid and Mailgun accept every message field Email SDK models, SES costs the least at volume, and Lettermint is an EU service with metadata and idempotency keys.

This post covers why teams leave, what to check, a sourced comparison, and a migration that keeps Postmark as the fallback until the new provider has proven itself. It ends with complete code that passes its own tests.

## Why teams look for a Postmark alternative

Most reasons come from Postmark's pricing page and from what its API accepts, not from deliverability.

- **The free plan is a test plan.** Postmark's [free Developer plan](https://postmarkapp.com/pricing) includes 100 emails a month with no overage. The next step is Basic at $15 a month for 10,000. A side project sending 1,000 emails a month pays the full $15.
- **No scheduled send.** Postmark has no provider-side scheduling, so a message with `sendAt` needs your own queue.
- **One tag per message.** Postmark has a single `Tag` field. Email SDK sends the first tag and rejects a second one before any request.
- **No idempotency keys.** A retried request after a timeout can deliver twice, and Postmark has no key to drop the repeat.
- **Region.** Teams that want an EU provider for data residency look at EU services such as Lettermint.

## Where Postmark is better

- **Message streams.** Transactional and broadcast mail run on separate streams, so a marketing send doesn't share a stream with password resets.
- **History.** Basic keeps 45 days of data, and Pro and Platform let you raise retention to 365 days. Mailgun's Basic plan keeps 1 day of logs, and Resend's free plan keeps 30 days.
- **Metadata.** Postmark stores per-message metadata. Resend and Amazon SES have no metadata field in Email SDK, so code that uses it has to change.
- **Inbound.** Pro and Platform include inbound email processing on the same account.

## What to check before you switch

Start from your Postmark integration, not from pricing pages.

- **Fields your code sends.** List every `metadata`, tag and header your sends use. The table below shows which providers accept them.
- **Templates.** Templates stored in Postmark don't move. Plan to render HTML in your code, or rebuild them in the new provider.
- **Streams.** Note which stream each email uses. A broadcast stream needs a provider that allows marketing mail, and the [Resend](/docs/adapters/resend) or [SendGrid](/docs/adapters/sendgrid) account you move to needs the same split.
- **Suppressions.** Export bounces and spam complaints from each Postmark stream and load them into the new provider or your own do-not-send list.
- **Webhooks.** Your bounce and delivery handlers read Postmark's payload today. Plan for both payloads during the cutover.

## The realistic options

Every price below comes from the provider's own pricing page, checked November 26, 2026 (Amazon SES checked November 2026). Prices change, so follow the link before you commit.

| Provider                                                            | Free tier                                                                                       | Entry paid plan                                                | Extra emails on entry plan      |
| ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ------------------------------- |
| [Postmark](https://postmarkapp.com/pricing) (today)                 | 100 emails/month, no overage                                                                    | Basic $15/mo for 10,000                                        | $1.80 per 1,000                 |
| [Resend](https://resend.com/pricing)                                | 3,000 emails/month, 100/day                                                                     | Pro $20/mo for 50,000                                          | $0.90 per 1,000                 |
| [SendGrid](https://www.twilio.com/en-us/products/email-api/pricing) | 60-day trial, 100 emails/day                                                                    | Essentials from $19.95/mo                                      | Depends on plan                 |
| [Mailgun](https://www.mailgun.com/pricing/)                         | 100 emails/day                                                                                  | Basic from $15/mo for 10,000                                   | From $1.80 per 1,000            |
| [Amazon SES](https://aws.amazon.com/ses/pricing/)                   | No SES free tier for new accounts since July 21, 2026; new AWS customers get up to $200 in credits | Essentials plan $0.16 per 1,000, or à la carte $0.10 per 1,000 | Same per-email rate             |
| [Lettermint](https://lettermint.co/pricing)                         | 300 emails/month                                                                                | Starter €10/mo for 10,000                                      | €1.50 per 1,000                 |

Each alternative below gets the same four lines, so you can compare them directly.

### Resend

- **Best for:** teams under 3,000 emails a month, or anyone who wants native idempotency keys and scheduled sends.
- **Free tier:** 3,000 emails a month, capped at 100 a day.
- **Gains over Postmark:** scheduled sends, multiple tags, native idempotency keys.
- **Gaps against Postmark:** no metadata field in Email SDK, and 30 days of data on the free plan against Postmark's 45 on Basic.

### SendGrid

- **Best for:** the smallest code change, since it accepts every message field Email SDK models.
- **Free tier:** a 60-day trial that sends 100 emails a day. Its [free plan was retired in May 2025](https://www.twilio.com/en-us/changelog/sendgrid-free-plan).
- **Gains over Postmark:** scheduled sends, multiple tags, metadata kept.
- **Gaps against Postmark:** no idempotency keys either, and Email SDK rejects repeated header names on SendGrid, which Postmark accepts.

### Mailgun

- **Best for:** teams that need scheduled sends and metadata at the same $15 entry price as Postmark Basic.
- **Free tier:** 100 emails a day.
- **Gains over Postmark:** scheduled sends, multiple tags, metadata kept, a free tier counted per day instead of per month.
- **Gaps against Postmark:** Basic keeps 1 day of logs against Postmark's 45 days, and no idempotency keys.

### Amazon SES

- **Best for:** high volume, where the per-email rate matters more than the dashboard.
- **Free tier:** none for new SES accounts since July 21, 2026. AWS [moved new accounts to pricing plans](https://aws.amazon.com/blogs/messaging-and-targeting/introducing-amazon-simple-email-service-ses-pricing-plans/), and new AWS customers get up to $200 in credits instead.
- **Gains over Postmark:** the lowest per-email price here, and multiple tags.
- **Gaps against Postmark:** no metadata, no scheduled send, no idempotency keys, and you manage bounce handling and logging yourself through configuration sets.

### Lettermint

- **Best for:** an EU email service with the Postmark fields most apps use.
- **Free tier:** 300 emails a month.
- **Gains over Postmark:** native idempotency keys, a larger free tier, and a lower entry price in euros.
- **Gaps against Postmark:** one tag per message, the same as Postmark, and no scheduled send.

### Which Postmark fields survive the move

This table comes from the SDK's adapter declarations. A "No" means the SDK rejects that message before sending instead of silently dropping the field.

| Field                     | Postmark              | Resend | SendGrid | Mailgun | Amazon SES | Lettermint            |
| ------------------------- | --------------------- | ------ | -------- | ------- | ---------- | --------------------- |
| CC, BCC, reply-to         | Yes                   | Yes    | Yes      | Yes     | Yes        | Yes                   |
| Custom headers            | Yes                   | Yes    | Yes      | Yes     | Yes        | Yes                   |
| Attachments               | Yes                   | Yes    | Yes      | Yes     | Yes        | Yes                   |
| Tags                      | Yes (one per message) | Yes    | Yes      | Yes     | Yes        | Yes (one per message) |
| Metadata                  | Yes                   | No     | Yes      | Yes     | No         | Yes                   |
| Scheduled send (`sendAt`) | No                    | Yes    | Yes      | Yes     | No         | No                    |
| Native idempotency        | No                    | Yes    | No       | No      | No         | Yes                   |

The full matrix lives on the [field support page](/docs/adapters/field-support). For a head-to-head, see [Resend vs Postmark](/compare/resend-vs-postmark), [Postmark vs SendGrid](/compare/postmark-vs-sendgrid), [Postmark vs Mailgun](/compare/postmark-vs-mailgun), or [Postmark vs AWS SES](/compare/postmark-vs-ses).

## Migrate with Postmark as the fallback

The plan below moves to Resend. Any adapter from the table works the same way: change the import and the options.

Email SDK puts both providers behind one client. Postmark stays configured as the fallback, and one environment variable decides which provider goes first. Cutover and rollback are both config changes, not new code.

### 1. Prepare the new provider

Verify your sending domain in Resend and publish the DNS records it gives you. Load the suppressions you exported from Postmark. Keep Postmark's DNS records and sender signatures in place, because Postmark still sends whenever it's the primary or the fallback.

### 2. Configure both adapters

Install the SDK:

```bash
npm install @opencoredev/email-sdk
```

`src/email.ts` in the complete code below registers both adapters. `defaultAdapter` reads `EMAIL_PRIMARY` and defaults to `postmark`, so after you deploy this file the same provider keeps sending until you flip the variable. The fallback list names both providers. The SDK skips whichever one is primary, so the other one is the backup in either direction.

Before any request leaves your server, the client checks the message against every adapter in its route, the fallback included. That check starts the day you deploy: a message with `metadata` throws `EmailValidationError`, even while Postmark is still primary, because Resend has no metadata field. Run your real messages through `email.validate()` in a test first. The receipt in `src/send.ts` moves its order id from metadata to a tag for that reason.

### 3. Decide which emails may fail over

A provider can return a 5xx or time out after it already accepted your message. The SDK marks those failures as delivery `unknown`, and by default it stops instead of trying the fallback, because the fallback could send a second copy. The [fallback guide](/docs/concepts/fallbacks-and-retries) explains the rule.

`onUnknownDelivery: "continue"` turns failover on for those failures. That's the right trade for a sign-in link, where a duplicate is harmless and a missing email locks someone out. It's the wrong trade for a receipt, so `src/send.ts` passes `fallback: { adapters: [] }` on the receipt. A failed receipt then throws `EmailRouteError` instead of trying Postmark. Before your queue retries it, check the provider's logs or delivery webhooks, because an `unknown` failure means the provider may already have sent it.

### 4. Cut over

Set `EMAIL_PRIMARY=resend` in one environment first. Watch Resend's logs and your error logs for a few days. To roll back, set `EMAIL_PRIMARY=postmark`.

Once Resend has handled a full week of real traffic, remove the Postmark adapter, then its server token and DNS records. Keep a `fallback` with another provider if you want a standing backup.

### 5. Move webhooks

The SDK's [webhook helpers](/docs/reference/webhooks) normalize delivery events from both Postmark and Resend and verify Resend's signatures, so one handler can accept both providers during the cutover.

## Complete code

Three files. The first two are what you deploy. The third runs the migration against fake provider responses with `bun test`, so you can check the fallback behavior before you touch a real account.

`src/email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { resend } from "@opencoredev/email-sdk/resend";

const adapterNames = ["resend", "postmark"] as const;

type AdapterName = (typeof adapterNames)[number];

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Missing environment variable ${name}.`);

  return value;
}

function parsePrimary(value = "postmark"): AdapterName {
  const name = adapterNames.find((candidate) => candidate === value);

  if (!name) throw new Error(`EMAIL_PRIMARY must be one of: ${adapterNames.join(", ")}.`);

  return name;
}

export const email = createEmailClient({
  adapters: [
    resend({ apiKey: requireEnv("RESEND_API_KEY") }),
    postmark({
      serverToken: requireEnv("POSTMARK_SERVER_TOKEN"),
      messageStream: "outbound",
    }),
  ],
  defaultAdapter: parsePrimary(process.env.EMAIL_PRIMARY),
  fallback: {
    adapters: adapterNames,
    onUnknownDelivery: "continue",
  },
});
```

`src/send.ts`:

```ts
import { email } from "./email";

export async function sendMagicLink(to: string, loginUrl: string) {
  return await email.send({
    from: "Acme <login@acme.com>",
    to,
    subject: "Your Acme sign-in link",
    text: `Sign in to Acme: ${loginUrl}\nThe link expires in 15 minutes.`,
    tags: [{ name: "type", value: "magic-link" }],
  });
}

export async function sendReceipt(to: string, orderId: string) {
  return await email.send(
    {
      from: "Acme <billing@acme.com>",
      to,
      subject: `Your Acme receipt for order ${orderId}`,
      text: `Thanks for your order ${orderId}.`,
      tags: [{ name: "order", value: orderId }],
    },
    { fallback: { adapters: [] } },
  );
}
```

The test swaps `fetch` for a fake that answers like Resend and Postmark, then checks four things: a normal send goes to Resend, a Resend 503 falls back to Postmark's outbound stream, a receipt doesn't fall back, and a message with metadata is rejected before any request.

`src/email.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { EmailRouteError, EmailValidationError } from "@opencoredev/email-sdk";

const testEnv = {
  EMAIL_SDK_TELEMETRY: "0",
  RESEND_API_KEY: "re_test",
  POSTMARK_SERVER_TOKEN: "test-postmark-token",
  EMAIL_PRIMARY: "resend",
};

const savedEnv = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]));

const realFetch = globalThis.fetch;

const calls: { host: string; body: RequestInit["body"] }[] = [];

let resendStatus = 200;

function fakeProviders(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  calls.push({ host: new URL(url).host, body: init?.body });

  if (url === "https://api.resend.com/emails") {
    return Promise.resolve(
      resendStatus === 200
        ? Response.json({ id: "re_1" })
        : Response.json({ message: "Service unavailable" }, { status: resendStatus }),
    );
  }

  if (url === "https://api.postmarkapp.com/email") {
    return Promise.resolve(
      Response.json({ To: "ada@example.com", MessageID: "pm_1", ErrorCode: 0, Message: "OK" }),
    );
  }

  return Promise.reject(new Error(`Unexpected request to ${url}`));
}

let send: typeof import("./send");

let client: typeof import("./email");

beforeAll(async () => {
  Object.assign(process.env, testEnv);
  globalThis.fetch = Object.assign(fakeProviders, { preconnect: realFetch.preconnect });
  client = await import("./email");
  send = await import("./send");
});

afterEach(() => {
  calls.length = 0;
  resendStatus = 200;
});

afterAll(() => {
  globalThis.fetch = realFetch;

  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Postmark to Resend migration example", () => {
  test("sends through Resend when it accepts the message", async () => {
    const result = await send.sendMagicLink("ada@example.com", "https://acme.com/login/abc");

    expect(result).toMatchObject({ adapter: "resend", id: "re_1" });
    expect(calls.map((call) => call.host)).toEqual(["api.resend.com"]);
    expect(JSON.parse(String(calls[0].body))).toMatchObject({
      from: "Acme <login@acme.com>",
      to: ["ada@example.com"],
      tags: [{ name: "type", value: "magic-link" }],
    });
  });

  test("falls back to Postmark's outbound stream when Resend returns a 503", async () => {
    resendStatus = 503;

    const result = await send.sendMagicLink("ada@example.com", "https://acme.com/login/abc");

    expect(result).toMatchObject({ adapter: "postmark", id: "pm_1" });
    expect(calls.map((call) => call.host)).toEqual(["api.resend.com", "api.postmarkapp.com"]);
    expect(JSON.parse(String(calls[1].body))).toMatchObject({
      To: "ada@example.com",
      Subject: "Your Acme sign-in link",
      MessageStream: "outbound",
      Tag: "type:magic-link",
    });
  });

  test("a receipt with fallback turned off stops after Resend fails", async () => {
    resendStatus = 503;

    const failure = await send.sendReceipt("ada@example.com", "ord_123").catch((error) => error);

    expect(failure).toBeInstanceOf(EmailRouteError);
    expect(calls.map((call) => call.host)).toEqual(["api.resend.com"]);
  });

  test("rejects Postmark-style metadata before any request, because Resend has no metadata field", async () => {
    const failure = await client.email
      .send({
        from: "Acme <hello@acme.com>",
        to: "ada@example.com",
        subject: "Welcome",
        text: "Hi",
        metadata: { userId: "user_123" },
      })
      .catch((error) => error);

    expect(failure).toBeInstanceOf(EmailValidationError);
    expect(String(failure.message)).toContain("resend");
    expect(calls).toEqual([]);
  });
});
```

Run it with `bun test src/email.test.ts`. All four tests pass against `@opencoredev/email-sdk` 3.1.0. They prove the routing and the main fields of each provider request. They don't prove delivery, which needs a real send from your own accounts.

## Related

- [Postmark adapter](/docs/adapters/postmark): server tokens, message streams, metadata, and the single-tag model.
- [Retries and fallback](/docs/concepts/fallbacks-and-retries): how delivery certainty decides when fallback runs.
- [Email API pricing compared](/blog/email-api-pricing): what each provider costs at the same volume.
- [Resend alternatives](/blog/resend-alternatives): the same migration, starting from Resend.
- [SendGrid alternatives](/blog/sendgrid-alternatives): the same migration, starting from SendGrid.
- [Mailgun alternatives](/blog/mailgun-alternatives): the same migration, starting from Mailgun.
- [How to send email from Node.js and TypeScript](/blog/send-email-nodejs-typescript): SMTP, a provider's HTTP API, or one client for any provider.
