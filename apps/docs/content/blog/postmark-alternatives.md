---
title: "Postmark Alternatives in 2026: 5 Email APIs and How to Switch"
description: "Postmark alternatives in 2026: Resend, Mailgun, SendGrid, Amazon SES and Lettermint by price and message fields, plus a TypeScript switch with Postmark as the fallback."
type: blog
date: 2026-11-26
lastModified: 2026-11-26
search:
  tags: ["Postmark", "Migration", "TypeScript"]
---

Stay on Postmark if you send at least a few thousand emails a month, want 45 days of history by default, and keep broadcasts on their own stream. Switch to Resend for a free tier of 3,000 emails a month and native idempotency keys, Mailgun or SendGrid for scheduled sends with metadata, Amazon SES for the lowest per-email price, or Lettermint for an EU-only service.

Every price below comes from the provider's own pricing page, checked November 26, 2026. Amazon SES rates come from its pricing page, checked November 2026, and the [AWS pricing plans announcement](https://aws.amazon.com/blogs/messaging-and-targeting/introducing-amazon-simple-email-service-ses-pricing-plans/), read November 26. Prices change, so follow the link before you commit.

| Provider                                                            | Free tier                                                                 | Entry paid plan                         | Extra emails on entry plan |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------- | --------------------------------------- | -------------------------- |
| [Postmark](https://postmarkapp.com/pricing) (today)                 | 100 emails/month, no overage                                              | Basic $15/mo for 10,000                 | $1.80 per 1,000            |
| [Resend](https://resend.com/pricing)                                | 3,000 emails/month, at most 100/day                                       | Pro $20/mo for 50,000                   | $0.90 per 1,000            |
| [Mailgun](https://www.mailgun.com/pricing/)                         | 100 emails/day                                                            | Basic from $15/mo for 10,000            | From $1.80 per 1,000       |
| [SendGrid](https://www.twilio.com/en-us/products/email-api/pricing) | 60-day trial, 100 emails/day                                              | Essentials from $19.95/mo               | Depends on plan and volume |
| [Amazon SES](https://aws.amazon.com/ses/pricing/)                   | None for new accounts since July 21, 2026; new AWS customers get up to $200 in credits | Essentials $0.16 per 1,000, or à la carte $0.10 per 1,000 | Per-email pricing, see the page for volume tiers |
| [Lettermint](https://lettermint.co/pricing)                         | 300 emails/month                                                          | Starter €10/mo for 10,000               | €1.50 per 1,000            |

## The five alternatives

Each block below stands on its own: what the provider is best for, its entry price, what you gain over Postmark, and what you lose.

### Resend

- **Best for:** apps under 3,000 emails a month, or teams that want native idempotency keys and scheduled sends.
- **Price:** free for 3,000 emails a month (100 a day), then Pro at $20 a month for 50,000 ([Resend pricing](https://resend.com/pricing)).
- **Gains over Postmark:** [scheduled sends up to 30 days ahead](https://resend.com/docs/dashboard/emails/schedule-email), several tags per message, and native idempotency keys.
- **Gaps against Postmark:** no metadata field in Email SDK, Email SDK rejects repeated header names on Resend, and the free plan keeps 30 days of data against 45 days on Postmark Basic.

### Mailgun

- **Best for:** scheduled sends and metadata at the same $15 entry price as Postmark Basic.
- **Price:** free for 100 emails a day, then Basic from $15 a month for 10,000, extra emails from $1.80 per 1,000 ([Mailgun pricing](https://www.mailgun.com/pricing/)).
- **Gains over Postmark:** scheduled sends (up to 3 days ahead on most plans, 7 with extended storage), several tags per message, metadata kept, and repeated header names accepted.
- **Gaps against Postmark:** the free plan and Basic keep 1 day of logs, and there are no idempotency keys.

### SendGrid

- **Best for:** teams already on Twilio that want scheduled sends and metadata.
- **Price:** a 60-day trial at 100 emails a day, then Essentials from $19.95 a month ([SendGrid pricing](https://www.twilio.com/en-us/products/email-api/pricing)). Twilio [began retiring the free plan in May 2025](https://www.twilio.com/en-us/changelog/sendgrid-free-plan).
- **Gains over Postmark:** scheduled sends up to 72 hours ahead, several tags per message, and metadata kept.
- **Gaps against Postmark:** no idempotency keys, and Email SDK rejects repeated header names on SendGrid, which Postmark accepts.

### Amazon SES

- **Best for:** high volume, where the per-email rate matters more than the dashboard.
- **Price:** Essentials at $0.16 per 1,000 or à la carte at $0.10 per 1,000, with no monthly fee ([SES pricing](https://aws.amazon.com/ses/pricing/)). New accounts have had no SES free tier since July 21, 2026.
- **Gains over Postmark:** the lowest per-email price here, and several tags per message.
- **Gaps against Postmark:** no metadata, no scheduled send, no idempotency keys, and you run bounce handling and logging yourself through configuration sets.

### Lettermint

- **Best for:** an [EU-only email service](https://lettermint.co/european-email) that keeps the Postmark fields most apps use.
- **Price:** free for 300 emails a month, then Starter at €10 a month for 10,000, extra emails €1.50 per 1,000 ([Lettermint pricing](https://lettermint.co/pricing)).
- **Gains over Postmark:** native idempotency keys, a larger free tier, and data processed and stored in the EU.
- **Gaps against Postmark:** one tag per message, the same as Postmark, no scheduled send, and Email SDK rejects repeated header names on Lettermint.

## Where Postmark is better

- **Message streams.** [Transactional and broadcast mail run on separate streams](https://postmarkapp.com/message-streams), so a marketing send doesn't share a stream with password resets.
- **History.** Basic keeps 45 days of data, and Pro and Platform can extend retention up to 365 days ([Postmark pricing](https://postmarkapp.com/pricing)). Mailgun's free plan and Basic keep 1 day of logs.
- **Metadata.** Postmark stores per-message metadata. Resend and Amazon SES have no metadata field in Email SDK, so code that uses it has to change.
- **Inbound.** Pro and Platform include inbound email processing on the same account.

## Reasons to switch

These come from Postmark's pricing page and from what the [Postmark Email API](https://postmarkapp.com/developer/api/email-api) accepts.

- **The free plan is a test plan.** It includes 100 emails a month with no overage, and the next step is Basic at $15 for 10,000. An app sending 1,000 emails a month pays the full $15.
- **No scheduled send.** Postmark has no provider-side scheduling, so a message with `sendAt` needs your own queue.
- **One tag per message.** Postmark has a single `Tag` field. Email SDK sends the first tag as `name:value` and rejects a second one before any request.
- **No idempotency keys.** A retried request after a timeout can deliver twice, and Postmark has no key to drop the repeat.

### Which Postmark fields survive the move

This table comes from the SDK's adapter declarations. A "No" means the SDK rejects that message before sending instead of silently dropping the field.

| Field                     | Postmark              | Resend | Mailgun | SendGrid | Amazon SES | Lettermint            |
| ------------------------- | --------------------- | ------ | ------- | -------- | ---------- | --------------------- |
| CC, BCC, reply-to         | Yes                   | Yes    | Yes     | Yes      | Yes        | Yes                   |
| Custom headers            | Yes                   | Yes    | Yes     | Yes      | Yes        | Yes                   |
| Repeated header names     | Yes                   | No     | Yes     | No       | Yes        | No                    |
| Attachments               | Yes                   | Yes    | Yes     | Yes      | Yes        | Yes                   |
| Tags                      | Yes (one per message) | Yes    | Yes     | Yes      | Yes        | Yes (one per message) |
| Metadata                  | Yes                   | No     | Yes     | Yes      | No         | Yes                   |
| Scheduled send (`sendAt`) | No                    | Yes    | Yes     | Yes      | No         | No                    |
| Native idempotency        | No                    | Yes    | No      | No       | No         | Yes                   |

The full matrix lives on the [field support page](/docs/adapters/field-support). For a head-to-head, see [Resend vs Postmark](/compare/resend-vs-postmark), [Postmark vs SendGrid](/compare/postmark-vs-sendgrid), [Postmark vs Mailgun](/compare/postmark-vs-mailgun), or [Postmark vs AWS SES](/compare/postmark-vs-ses).

## What to move besides the send call

A Postmark integration carries more than message fields. Check each of these before you write code.

- **Tag values.** The Postmark adapter writes a tag as `name:value`, for example `type:receipt`. If your dashboards or bounce rules filter on that string, check how the new provider stores tags before you switch.
- **Streams.** Note which [message stream](https://postmarkapp.com/message-streams) each email uses. The example below sends everything through `outbound`. Broadcast streams need a provider and account that allow marketing mail, and a separate sender if you want to keep the split.
- **Templates.** Templates stored in Postmark don't move. Render HTML in your code, or rebuild them in the new provider.
- **Suppressions.** [Postmark keeps suppressions per stream](https://postmarkapp.com/developer/api/suppressions-api), while [Resend's apply to your whole team](https://resend.com/docs/dashboard/emails/email-suppressions), transactional mail included. Load hard bounces and spam complaints into the new provider. Keep broadcast unsubscribes in your own audience or do-not-email list instead, so an unsubscribe from a newsletter doesn't block password resets.
- **Webhooks.** Your bounce and delivery handlers read Postmark's payload today and need to read both during the cutover.

## Migrate with Postmark as the fallback

The plan below moves to Resend. Email SDK puts both providers behind one client. Postmark stays configured as the fallback, and one environment variable decides which provider goes first, so cutover and rollback are config changes.

### 1. Prepare Resend and the webhooks

Do this before any code ships, because Resend can receive production mail as soon as the two-adapter client deploys, even as the fallback.

Verify your sending domain in Resend, publish its DNS records, and load your hard bounces and complaints. Keep Postmark's DNS records and sender signatures in place.

Point a Resend webhook at your delivery handler and send yourself a test event. The SDK's [webhook helpers](/docs/reference/webhooks) verify Resend's signatures and normalize delivery events from both providers. They don't authenticate Postmark requests, so keep the protection your Postmark webhook URL already has.

### 2. Configure both adapters

Install the SDK:

```bash
npm install @opencoredev/email-sdk
```

`src/email.ts` in the complete code below registers both adapters. `defaultAdapter` reads `EMAIL_PRIMARY` and defaults to `postmark`, so the same provider keeps sending until you flip the variable. The fallback list names both providers, and the SDK skips whichever one is primary.

Before any request leaves your server, the client checks the message against every adapter in its route, the fallback included. That check starts the day you deploy: a message with `metadata` throws `EmailValidationError`, even while Postmark is still primary, because Resend has no metadata field. Run your real messages through `email.validate()` in a test first. The receipt in `src/send.ts` moves its order id from metadata to a tag for that reason.

### 3. Decide which emails may fail over

A provider can time out or return a 5xx, 408, 409 or 429 after it already accepted your message. The SDK marks those failures as delivery `unknown`, and by default it stops instead of trying the fallback, because the fallback could send a second copy. The [fallback guide](/docs/concepts/fallbacks-and-retries) explains the rule.

The client in `src/email.ts` keeps that default. Only the sign-in link in `src/send.ts` passes `onUnknownDelivery: "continue"`, because a duplicate sign-in link is harmless and a missing one locks someone out. A receipt keeps the default, so an unknown failure throws `EmailRouteError`. Before your queue retries it, check Resend's logs or delivery webhooks, because the provider may already have sent it.

Resend's native `idempotencyKey` can't help while Postmark is in the same route: the SDK rejects the key for Postmark unless you pass `idempotency: "best-effort"`, which sends without deduplication on Postmark.

### 4. Cut over

Set `EMAIL_PRIMARY=resend` in one environment first. Watch Resend's logs and your error logs for a few days. To roll back, set `EMAIL_PRIMARY=postmark`.

### 5. Retire Postmark

Once Resend has handled a full week of real traffic, deploy a Resend-only client. Remove Postmark from the adapter list, the fallback list and the primary selector in the same change, because the client checks at startup that every name it routes to is registered:

```ts
export const email = createEmailClient({
  adapters: [resend({ apiKey: requireEnv("RESEND_API_KEY") })],
});
```

Drop the `fallback` option from the sign-in link too. After that deploy is live, revoke the Postmark server token and remove its DNS records.

## Complete code

Three files. The first two are what you deploy during the cutover. The third runs the migration against fake provider responses with `bun test`, so you can check the fallback behavior before you touch a real account.

`src/email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { resend } from "@opencoredev/email-sdk/resend";

export const adapterNames = ["resend", "postmark"] as const;

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
  fallback: { adapters: adapterNames },
});
```

`src/send.ts`:

```ts
import { adapterNames, email } from "./email";

export async function sendMagicLink(to: string, loginUrl: string) {
  return await email.send(
    {
      from: "Acme <login@acme.com>",
      to,
      subject: "Your Acme sign-in link",
      text: `Sign in to Acme: ${loginUrl}\nThe link expires in 15 minutes.`,
      tags: [{ name: "type", value: "magic-link" }],
    },
    { fallback: { adapters: adapterNames, onUnknownDelivery: "continue" } },
  );
}

export async function sendReceipt(to: string, orderId: string) {
  return await email.send({
    from: "Acme <billing@acme.com>",
    to,
    subject: `Your Acme receipt for order ${orderId}`,
    text: `Thanks for your order ${orderId}.`,
    tags: [{ name: "order", value: orderId }],
  });
}
```

The test swaps `fetch` for a fake that answers like Resend and Postmark, then checks four things: a normal send goes to Resend, a sign-in link falls back to Postmark's outbound stream when Resend returns a 503, a receipt doesn't fall back, and a message with metadata is rejected before any request.

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

  test("a sign-in link falls back to Postmark's outbound stream when Resend returns a 503", async () => {
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

  test("a receipt stops after Resend returns a 503", async () => {
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
- [Resend pricing](/blog/resend-pricing): every Resend plan, its limits and overage.
- [SendGrid alternatives](/blog/sendgrid-alternatives): the same kind of migration, starting from SendGrid.
- [Mailgun alternatives](/blog/mailgun-alternatives): the same kind of migration, starting from Mailgun.
- [How to send email from Node.js and TypeScript](/blog/send-email-nodejs-typescript): SMTP, a provider's HTTP API, or one client for any provider.
