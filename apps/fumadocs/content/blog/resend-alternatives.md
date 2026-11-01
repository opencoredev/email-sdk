# Resend Alternatives for Developers, and How to Switch

Resend is a good default for transactional email. It has the largest free tier of the providers below, native idempotency keys, scheduled sends, and 30 days of logs on every self-serve plan. Teams that look elsewhere usually have one specific reason: the bill at high volume, a dedicated IP before they reach the Scale plan, per-message metadata, or EU-only data processing. Whatever the reason, the hard part isn't picking a provider. It's switching without a rewrite and without losing mail during the cutover.

This post covers what to check before you move, a short sourced comparison, and a migration to Amazon SES that keeps Resend as the fallback until SES has proven itself. It ends with complete code that passes its own tests.

## What to look for in a replacement

Start from the Resend features your code uses, then read pricing pages.

- **Price at your volume.** Resend Pro is $20 a month for 50,000 emails. At a million emails a month, Resend's Scale plan is $650, and Amazon SES on its Essentials plan is $160 before data charges. Below a few hundred thousand emails, the difference may not cover the extra work SES needs.
- **Dedicated IPs.** Resend sells dedicated IPs as a $30 add-on on Scale, for accounts sending more than 3,000 emails a day. If you need one earlier, check where each provider offers them.
- **Fields your code sends.** Resend takes tags and `scheduled_at`, but no per-message metadata. Moving to a provider without scheduled sends means `sendAt` needs a queue on your side. The table below shows which fields survive.
- **Duplicate protection.** Resend honors an `Idempotency-Key` header for 24 hours, so a retried request doesn't send twice. Most alternatives don't, which changes how safely you can retry.
- **Log retention.** Resend keeps 30 days of emails and logs. If support answers "did this user get the email?" from the dashboard, compare that number.
- **Webhooks, suppressions, and templates.** Point delivery webhooks at a new endpoint, copy your suppressed addresses to the new provider, and render HTML in your own code if you use Resend-hosted templates.

## The realistic options

Every price below comes from the provider's own pricing page, checked November 1, 2026. Prices change, so follow the link before you commit.

| Provider | Free tier | Entry paid plan | Retention on entry plan |
| --- | --- | --- | --- |
| [Resend](https://resend.com/pricing) (today) | 3,000 emails/month, 100/day | Pro $20/mo for 50,000, then $0.90 per 1,000 | 30 days of emails and logs |
| [Amazon SES](https://aws.amazon.com/ses/pricing/) | No SES free tier for new accounts since July 2026; new AWS customers get up to $200 in credits | Essentials plan $0.16 per 1,000, or à la carte $0.10 per 1,000 | Up to your own logging setup |
| [Postmark](https://postmarkapp.com/pricing) | 100 emails/month, doesn't expire | Basic $15/mo for 10,000, then $1.80 per 1,000 | 45 days |
| [Mailgun](https://www.mailgun.com/pricing/) | 100 emails/day | Basic from $15/mo (10,000 emails) | 1 day of logs (5 on Foundation) |
| [SendGrid](https://www.twilio.com/en-us/products/email-api/pricing) | 60-day trial, 100 emails/day | Essentials from $19.95/mo | 3 days of email activity |
| [Lettermint](https://lettermint.co/pricing) | 300 emails/month | Starter €10/mo for 10,000 | 28 days of message history |

For Resend's own tiers, daily caps, and overage math, see [Resend pricing](/blog/resend-pricing).

**Amazon SES** is the cheapest at volume, and you run more of it yourself: you request production access to leave the SES sandbox, handle bounces and complaints, and set up logging through configuration sets. AWS [moved new accounts to pricing plans](https://aws.amazon.com/blogs/messaging-and-targeting/introducing-amazon-simple-email-service-ses-pricing-plans/) on July 21, 2026, and the old 3,000-message SES free tier doesn't apply to them.

**Postmark** is built for transactional mail and keeps 45 days of full message history. It supports per-message metadata, but it takes only one tag per message and has no scheduled send.

**Mailgun** supports every message field Email SDK models, including metadata and scheduled sends. Its Basic plan keeps only a day of logs.

**SendGrid** also supports metadata and scheduled sends, and puts marketing email in the same account. Twilio [retired its free plan in May 2025](https://www.twilio.com/en-us/changelog/sendgrid-free-plan).

**Lettermint** processes and stores email data only in the EU. Like Resend, it has native idempotency keys, and it accepts metadata, though only one tag per message.

### Which Resend fields survive the move

This table comes from the SDK's adapter declarations. A "No" means the SDK rejects that message before sending instead of silently dropping the field.

| Field | Resend | Amazon SES | Postmark | Mailgun | SendGrid | Lettermint |
| --- | --- | --- | --- | --- | --- | --- |
| CC, BCC, reply-to | Yes | Yes | Yes | Yes | Yes | Yes |
| Custom headers | Yes | Yes | Yes | Yes | Yes | Yes |
| Repeated header names | No | Yes | Yes | Yes | No | No |
| Attachments | Yes | Yes | Yes | Yes | Yes | Yes |
| Tags | Yes | Yes | Yes (one per message) | Yes | Yes | Yes (one per message) |
| Metadata | No | No | Yes | Yes | Yes | Yes |
| Scheduled send (`sendAt`) | Yes | No | No | Yes | Yes | No |
| Native idempotency | Yes | No | No | No | No | Yes |

The full matrix lives on the [field support page](/docs/adapters/field-support). Adapter details are on the [Amazon SES](/docs/adapters/ses), [Postmark](/docs/adapters/postmark), [Mailgun](/docs/adapters/mailgun), [SendGrid](/docs/adapters/sendgrid), and [Lettermint](/docs/adapters/lettermint) pages. For a head-to-head, see [Resend vs Amazon SES](/compare/resend-vs-ses), [Resend vs Postmark](/compare/resend-vs-postmark), [Resend vs Mailgun](/compare/resend-vs-mailgun), or [Resend vs SendGrid](/compare/resend-vs-sendgrid).

## Migrate with Resend as the fallback

The plan below moves to Amazon SES, the usual destination when the reason is cost. Any adapter from the table works the same way: change the import and the options.

Email SDK puts both providers behind one client. Resend stays configured as the fallback, and one environment variable decides which provider goes first. Cutover and rollback are both config changes, not new code.

### 1. Prepare SES

Do this before any code ships, because it takes a few days. Verify your sending domain in SES and publish its DKIM records, in the region you'll send from. Request production access, since new accounts start in the SES sandbox and can only send to verified addresses. Create a configuration set with an event destination for send, delivery, bounce, and complaint events, and load the addresses Resend has suppressed into the SES account-level suppression list. Keep Resend's DNS records in place, because Resend still sends whenever it's the primary or the fallback.

### 2. Configure both adapters

Install the SDK:

```bash
npm install @opencoredev/email-sdk
```

`src/email.ts` in the complete code at the end of this post registers both adapters. `defaultAdapter` reads `EMAIL_PRIMARY` and defaults to `resend`, so after you deploy this file Resend keeps sending until you flip the variable. The fallback list names both providers. The SDK always skips whichever one is primary, so the other one is the backup in either direction. The SES adapter signs its own requests with AWS Signature V4, so you don't need the AWS SDK. `sessionToken` covers temporary credentials from an IAM role, and `configurationSetName` attaches your configuration set to every send so its events get published.

Before any request leaves your server, the client checks the message against every adapter in its route, the fallback included. That check starts the day you deploy: a message with `sendAt` throws `EmailValidationError`, even while Resend is still primary, because SES has no scheduled send. Before you deploy, run your real messages through `email.validate()` in a test. For a message type that has to keep `sendAt`, pass `{ adapter: "resend", fallback: { adapters: [] } }` on its send until you've moved scheduling into a queue.

SES is also stricter about tags. A tag name or value may only contain ASCII letters, numbers, underscores, and dashes (see [MessageTag](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_MessageTag.html)), so a Resend tag like `plan: "pro tier"` needs a new value.

### 3. Decide which emails may fail over

A provider can return a 5xx or time out after it already accepted your message. The SDK marks those failures as delivery `unknown`, and by default it stops instead of trying the fallback, because the fallback could send a second copy. The [fallback guide](/docs/concepts/fallbacks-and-retries) explains the rule.

`onUnknownDelivery: "continue"` turns failover on for those failures. That's the right trade for a password reset, where a duplicate is harmless and a missing email locks someone out. It's the wrong trade for a receipt. `src/send.ts` passes `fallback: { adapters: [] }` on the receipt, so a failed receipt throws `EmailRouteError` instead of trying a second provider.

Moving the primary to SES also changes your retry story. Resend drops a repeated request that carries the same `idempotencyKey`. SES has no idempotency keys, so a retry after an `unknown` failure can deliver twice. Before your queue retries an SES send, look for its Send or Delivery event from the configuration set, matched by a tag you set on each message, like the `order` tag on the receipt below. A missing event doesn't prove SES never sent it, because events can arrive late, so mail that must never go out twice shouldn't retry automatically.

### 4. Cut over

Set `EMAIL_PRIMARY=ses` in one environment first. Watch the SES sending statistics, your bounce and complaint rates, and your error logs for a few days. To roll back, set `EMAIL_PRIMARY=resend`.

Once SES has handled a full week of real traffic, decide whether to keep Resend as the standing fallback. If you remove it, wait until any scheduled sends Resend still holds have gone out, then delete its API key and its sending DNS records. If Resend still receives your inbound mail, keep its MX records.

### 5. Move what the SDK doesn't carry

- **Scheduled sends.** Move `sendAt` messages to your own job queue, or keep them on Resend: send them with `{ adapter: "resend", fallback: { adapters: [] } }`. The empty fallback matters, because the SDK validates every adapter in the route and SES would reject `sendAt`.
- **Webhooks.** SES publishes events through configuration-set destinations (SNS, EventBridge, Firehose, or CloudWatch), not HTTP webhooks. The SDK's [webhook helpers](/docs/reference/webhooks) normalize Resend, Postmark, and Mailgun events. They don't cover SES, so you'll write that consumer yourself, and keep your Resend handler while Resend still sends.
- **Inbound mail.** If you receive email through Resend, it can stay there. Sending and receiving don't need the same provider.

## Complete code

Three files. The first two are what you deploy. The third runs the migration against fake provider responses with `bun test`, so you can check the fallback behavior before you touch a real account.

`src/email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";
import { ses } from "@opencoredev/email-sdk/ses";

const adapterNames = ["ses", "resend"] as const;

type AdapterName = (typeof adapterNames)[number];

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Missing environment variable ${name}.`);

  return value;
}

function parsePrimary(value = "resend"): AdapterName {
  const name = adapterNames.find((candidate) => candidate === value);

  if (!name) throw new Error(`EMAIL_PRIMARY must be one of: ${adapterNames.join(", ")}.`);

  return name;
}

export const email = createEmailClient({
  adapters: [
    ses({
      accessKeyId: requireEnv("AWS_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("AWS_SECRET_ACCESS_KEY"),
      sessionToken: process.env.AWS_SESSION_TOKEN,
      region: requireEnv("AWS_REGION"),
      configurationSetName: requireEnv("SES_CONFIGURATION_SET"),
    }),
    resend({ apiKey: requireEnv("RESEND_API_KEY") }),
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

export async function sendPasswordReset(to: string, resetUrl: string) {
  return await email.send({
    from: "Acme <security@acme.com>",
    to,
    subject: "Reset your Acme password",
    text: `Reset your password: ${resetUrl}\nThe link expires in 30 minutes.`,
    tags: [{ name: "type", value: "password-reset" }],
  });
}

export async function sendReceipt(to: string, orderId: string) {
  return await email.send(
    {
      from: "Acme <billing@acme.com>",
      to,
      subject: `Your Acme receipt for order ${orderId}`,
      text: `Thanks for your order ${orderId}.`,
      tags: [
        { name: "type", value: "receipt" },
        { name: "order", value: orderId },
      ],
    },
    { fallback: { adapters: [] } },
  );
}
```

The test swaps `fetch` for a fake that answers like SES and Resend, then checks four things: a normal send goes to SES, an SES 503 falls back to Resend, a receipt doesn't fall back, and a scheduled send is rejected before any request.

`src/email.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { EmailRouteError, EmailValidationError } from "@opencoredev/email-sdk";

const testEnv = {
  EMAIL_SDK_TELEMETRY: "0",
  AWS_ACCESS_KEY_ID: "AKIATEST",
  AWS_SECRET_ACCESS_KEY: "test-secret",
  AWS_REGION: "us-east-1",
  SES_CONFIGURATION_SET: "transactional",
  RESEND_API_KEY: "re_test",
  EMAIL_PRIMARY: "ses",
};

const savedEnv = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]));

const realFetch = globalThis.fetch;

const calls: { host: string; body: string }[] = [];

let sesStatus = 200;

function fakeProviders(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  calls.push({ host: new URL(url).host, body: String(init?.body) });

  if (url === "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails") {
    return Promise.resolve(
      sesStatus === 200
        ? Response.json({ MessageId: "ses_1" })
        : Response.json({ message: "Service unavailable" }, { status: sesStatus }),
    );
  }

  if (url === "https://api.resend.com/emails") {
    return Promise.resolve(Response.json({ id: "re_1" }));
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
  sesStatus = 200;
});

afterAll(() => {
  globalThis.fetch = realFetch;

  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Resend to Amazon SES migration example", () => {
  test("sends through SES when it accepts the message", async () => {
    const result = await send.sendPasswordReset("ada@example.com", "https://acme.com/reset/abc");

    expect(result).toMatchObject({ adapter: "ses", id: "ses_1" });
    expect(calls.map((call) => call.host)).toEqual(["email.us-east-1.amazonaws.com"]);
    expect(JSON.parse(calls[0].body)).toMatchObject({
      ConfigurationSetName: "transactional",
      FromEmailAddress: "Acme <security@acme.com>",
      Destination: { ToAddresses: ["ada@example.com"] },
      EmailTags: [{ Name: "type", Value: "password-reset" }],
    });
  });

  test("falls back to Resend when SES returns a 503", async () => {
    sesStatus = 503;

    const result = await send.sendPasswordReset("ada@example.com", "https://acme.com/reset/abc");

    expect(result).toMatchObject({ adapter: "resend", id: "re_1" });
    expect(calls.map((call) => call.host)).toEqual(["email.us-east-1.amazonaws.com", "api.resend.com"]);
    expect(JSON.parse(calls[1].body)).toMatchObject({
      to: ["ada@example.com"],
      subject: "Reset your Acme password",
      tags: [{ name: "type", value: "password-reset" }],
    });
  });

  test("a receipt with fallback turned off stops after SES fails", async () => {
    sesStatus = 503;

    const failure = await send.sendReceipt("ada@example.com", "ord_123").catch((error) => error);

    expect(failure).toBeInstanceOf(EmailRouteError);
    expect(calls.map((call) => call.host)).toEqual(["email.us-east-1.amazonaws.com"]);
    expect(JSON.parse(calls[0].body)).toMatchObject({
      EmailTags: [
        { Name: "type", Value: "receipt" },
        { Name: "order", Value: "ord_123" },
      ],
    });
  });

  test("rejects a scheduled send before any request, because SES has no sendAt", async () => {
    const failure = await client.email
      .send({
        from: "Acme <hello@acme.com>",
        to: "ada@example.com",
        subject: "Tomorrow",
        text: "Scheduled",
        sendAt: new Date(Date.now() + 86_400_000),
      })
      .catch((error) => error);

    expect(failure).toBeInstanceOf(EmailValidationError);
    expect(String(failure.message)).toContain("ses");
    expect(calls).toEqual([]);
  });
});
```

Run it with `bun test src/email.test.ts`. All four tests pass against `@opencoredev/email-sdk` 3.0.1. They prove the routing and the main fields of each provider request. They don't prove delivery, which needs a real send from your own accounts.

## Related

- [Resend pricing](/blog/resend-pricing): Resend's plans, the free tier's daily cap, and overage rates.
- [Resend API guide for Node.js and TypeScript](/blog/resend-api-nodejs-typescript): keys, idempotency, rate limits, and webhooks.
- [Resend adapter](/docs/adapters/resend) and [Amazon SES adapter](/docs/adapters/ses): options and field mapping.
- [Retries and fallback](/docs/concepts/fallbacks-and-retries): how delivery certainty decides when fallback runs.
- [SendGrid alternatives](/blog/sendgrid-alternatives) and [Mailgun alternatives](/blog/mailgun-alternatives): the same migration, starting from another provider.
