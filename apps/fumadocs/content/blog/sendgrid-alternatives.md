# SendGrid Alternatives for Developers, and How to Switch

People leave SendGrid for two reasons. Twilio [retired the free plan in May 2025](https://www.twilio.com/en-us/changelog/sendgrid-free-plan), so even a side project now pays from $19.95 a month after the 60-day trial. The other reason is deliverability or support trouble, which this page can't measure for you. Either way, picking a provider is the easy part. The hard part is switching without a rewrite and without losing mail during the cutover.

This post covers what to check in a replacement, a short sourced comparison, and a migration that keeps SendGrid as the fallback until the new provider has proven itself. It ends with complete code that passes its own tests.

## What to look for in a replacement

Read your current SendGrid integration before you read any pricing page. The fields you actually send decide which providers can take over without code changes.

- **Fields your code sends.** SendGrid takes `custom_args`, multiple `categories`, and `send_at`. Not every provider has all three. The table below shows which ones survive the move.
- **Price at your volume.** Free tiers range from none to 3,000 emails a month. Compare the plan you'll be on in six months, not the free one.
- **Log retention.** SendGrid Essentials keeps 3 days of searchable email activity. If support needs to answer "did this user get the email?", check how far back the new provider goes.
- **Duplicate protection.** A provider with native idempotency keys can safely retry a request that timed out. Without them, a retry can send the same email twice.
- **Templates.** SendGrid dynamic templates live in your SendGrid account. No other provider can render them, so plan to move rendering into your code.
- **Suppressions.** Export your [bounces, blocks, and spam reports](https://www.twilio.com/docs/sendgrid/ui/sending-email/index-suppressions) and import them into the new provider. Otherwise your first week of sends hits addresses SendGrid already knew to skip.

## The realistic options

Every price below comes from the provider's own pricing page, checked October 29, 2026. Prices change, so follow the link before you commit.

| Provider | Free tier | Entry paid plan | Retention on entry plan |
| --- | --- | --- | --- |
| [SendGrid](https://www.twilio.com/en-us/products/email-api/pricing) (today) | 60-day trial, 100 emails/day | Essentials from $19.95/mo | 3 days of email activity |
| [Postmark](https://postmarkapp.com/pricing) | 100 emails/month, doesn't expire | Basic $15/mo for 10,000, then $1.80 per 1,000 | 45 days |
| [Mailgun](https://www.mailgun.com/pricing/) | 100 emails/day | Basic from $15/mo (10,000 emails) | 1 day of logs (5 on Foundation) |
| [Amazon SES](https://aws.amazon.com/ses/pricing/) | No SES free tier for new accounts since July 2026; new AWS customers get up to $200 in credits | Essentials plan $0.16 per 1,000, or à la carte $0.10 per 1,000 | Up to your own logging setup |
| [Resend](https://resend.com/pricing) | 3,000 emails/month, 100/day | Pro $20/mo for 50,000, then $0.90 per 1,000 | 30 days of emails and logs |
| [Lettermint](https://lettermint.co/pricing) | 300 emails/month | Starter €10/mo for 10,000 | 28 days of message history |

**Postmark** is the usual pick for transactional-only mail. It has no tier between 100 and 10,000 emails a month, so a small app pays $15 from day one.

**Mailgun** is closest to SendGrid in features and supports every message field the SDK models. It's the lowest-effort swap, though Basic keeps only a day of logs.

**Amazon SES** is cheapest at volume, and you manage more yourself: bounce handling, reputation, and logging through configuration sets. AWS [moved new accounts to pricing plans](https://aws.amazon.com/blogs/messaging-and-targeting/introducing-amazon-simple-email-service-ses-pricing-plans/) on July 21, 2026, and the old 3,000-message SES free tier doesn't apply to them.

**Resend** has the largest free tier here and native idempotency keys. It doesn't take per-message metadata, so `custom_args` need another home.

**Lettermint** processes and stores email data only in the EU, which matters if you need EU data residency. It also has native idempotency keys.

### Which SendGrid fields survive the move

SendGrid supports all eight message fields that Email SDK models. This table comes from the SDK's adapter declarations and shows what each alternative can receive. A "No" means the SDK rejects that message before sending instead of silently dropping the field.

| Field | SendGrid | Postmark | Mailgun | Amazon SES | Resend | Lettermint |
| --- | --- | --- | --- | --- | --- | --- |
| CC, BCC, reply-to | Yes | Yes | Yes | Yes | Yes | Yes |
| Custom headers | Yes | Yes | Yes | Yes | Yes | Yes |
| Attachments | Yes | Yes | Yes | Yes | Yes | Yes |
| Tags | Yes | Yes (one per message) | Yes | Yes | Yes | Yes (one per message) |
| Metadata (`custom_args`) | Yes | Yes | Yes | No | No | Yes |
| Scheduled send (`sendAt`) | Yes | No | Yes | No | Yes | No |
| Native idempotency | No | No | No | No | Yes | Yes |

The full matrix lives on the [field support page](/docs/adapters/field-support). Adapter details are on the [Postmark](/docs/adapters/postmark), [Mailgun](/docs/adapters/mailgun), [Amazon SES](/docs/adapters/ses), [Resend](/docs/adapters/resend), and [Lettermint](/docs/adapters/lettermint) pages. For a head-to-head, see [Postmark vs SendGrid](/compare/postmark-vs-sendgrid), [SendGrid vs Mailgun](/compare/sendgrid-vs-mailgun), [Resend vs SendGrid](/compare/resend-vs-sendgrid), or [SendGrid vs SES](/compare/sendgrid-vs-ses).

## Migrate with SendGrid as the fallback

The plan below moves to Postmark. Any adapter from the table works the same way: change the import and the options.

Email SDK puts both providers behind one client. SendGrid stays configured as the fallback, and one environment variable decides which provider goes first. Cutover and rollback are both config changes, not new code.

### 1. Prepare the new provider

Do this before any code ships. Verify your sending domain in Postmark and publish its DKIM and Return-Path records. Import the suppressions you exported from SendGrid. Keep SendGrid's DNS records in place, because SendGrid still sends whenever it's the primary or the fallback.

### 2. Configure both adapters

Install the SDK:

```bash
npm install @opencoredev/email-sdk
```

`src/email.ts` in the complete code at the end of this post registers both adapters. `defaultAdapter` reads `EMAIL_PRIMARY` and defaults to `sendgrid`, so after you deploy this file the same provider keeps sending until you flip the variable. The fallback list names both providers. The SDK always skips whichever one is primary, so the other one is the backup in either direction.

Before any request leaves your server, the client checks the message against every adapter in its route, the fallback included. That check starts the day you deploy: a message with `sendAt` throws `EmailValidationError`, even while SendGrid is still primary, because Postmark has no scheduled send. Before you deploy, run your real messages through `email.validate()` in a test. For a message type that has to keep that field, pass `fallback: { adapters: [] }` on its send until you've moved it.

### 3. Decide which emails may fail over

A provider can return a 5xx or time out after it already accepted your message. The SDK marks those failures as delivery `unknown`, and by default it stops instead of trying the fallback, because the fallback could send a second copy. The [fallback guide](/docs/concepts/fallbacks-and-retries) explains the rule.

`onUnknownDelivery: "continue"` turns failover on for those failures. That's the right trade for a password reset, where a duplicate is harmless and a missing email locks someone out. It's the wrong trade for a receipt. `src/send.ts` passes `fallback: { adapters: [] }` on the receipt, so a failed receipt throws `EmailRouteError` instead of trying a second provider. That alone doesn't make a later retry safe: an `unknown` failure means the provider may already have sent it. Before your queue retries, look the message up in the provider's logs or delivery webhooks. With a provider that has native idempotency keys (Resend or Lettermint), pass the same `idempotencyKey` on every attempt so the provider can drop a repeat.

### 4. Cut over

Set `EMAIL_PRIMARY=postmark` in one environment first. Watch Postmark's activity feed and your error logs for a few days. To roll back, set `EMAIL_PRIMARY=sendgrid`.

Once Postmark has handled a full week of real traffic, remove the SendGrid adapter so no new mail goes to SendGrid. Wait until any scheduled sends SendGrid still holds have gone out, then delete its API key and DNS records. Keep a `fallback` with another provider if you want a standing backup.

### 5. Move what the SDK doesn't carry

- **Templates.** The SendGrid adapter doesn't send `template_id`. Render HTML in your code, for example with [Email UI](/docs/ui) templates, and pass it as `html`.
- **Categories.** SendGrid accepts many categories per message. Postmark and Lettermint take one tag, and their adapters reject a message with more.
- **Webhooks.** Point Postmark's delivery webhooks at a new endpoint. The SDK's [webhook helpers](/docs/reference/webhooks) normalize Postmark, Resend, and Mailgun events into one shape. They don't cover SendGrid, so keep your current SendGrid handler until SendGrid is gone.

## Complete code

Three files. The first two are what you deploy. The third runs the migration against fake provider responses with `bun test`, so you can check the fallback behavior before you touch a real account.

`src/email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { sendgrid } from "@opencoredev/email-sdk/sendgrid";

const adapterNames = ["postmark", "sendgrid"] as const;

type AdapterName = (typeof adapterNames)[number];

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Missing environment variable ${name}.`);

  return value;
}

function parsePrimary(value = "sendgrid"): AdapterName {
  const name = adapterNames.find((candidate) => candidate === value);

  if (!name) throw new Error(`EMAIL_PRIMARY must be one of: ${adapterNames.join(", ")}.`);

  return name;
}

export const email = createEmailClient({
  adapters: [
    postmark({ serverToken: requireEnv("POSTMARK_SERVER_TOKEN") }),
    sendgrid({ apiKey: requireEnv("SENDGRID_API_KEY") }),
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
      metadata: { orderId },
    },
    { fallback: { adapters: [] } },
  );
}
```

The test swaps `fetch` for a fake that answers like Postmark and SendGrid, then checks four things: a normal send goes to Postmark, a Postmark 503 falls back to SendGrid, a receipt doesn't fall back, and a scheduled send is rejected before any request.

`src/email.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { EmailRouteError, EmailValidationError } from "@opencoredev/email-sdk";

const testEnv = {
  EMAIL_SDK_TELEMETRY: "0",
  POSTMARK_SERVER_TOKEN: "test-postmark-token",
  SENDGRID_API_KEY: "SG.test",
  EMAIL_PRIMARY: "postmark",
};

const savedEnv = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]));

const realFetch = globalThis.fetch;

const calls: { host: string; body: string }[] = [];

let postmarkStatus = 200;

function fakeProviders(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  calls.push({ host: new URL(url).host, body: String(init?.body) });

  if (url === "https://api.postmarkapp.com/email") {
    return Promise.resolve(
      postmarkStatus === 200
        ? Response.json({ MessageID: "pm_1", To: "ada@example.com", ErrorCode: 0 })
        : Response.json({ ErrorCode: 701, Message: "Service unavailable" }, { status: postmarkStatus }),
    );
  }

  if (url === "https://api.sendgrid.com/v3/mail/send") {
    return Promise.resolve(new Response(null, { status: 202, headers: { "x-message-id": "sg_1" } }));
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
  postmarkStatus = 200;
});

afterAll(() => {
  globalThis.fetch = realFetch;

  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("SendGrid to Postmark migration example", () => {
  test("sends through Postmark when it accepts the message", async () => {
    const result = await send.sendPasswordReset("ada@example.com", "https://acme.com/reset/abc");

    expect(result).toMatchObject({ adapter: "postmark", id: "pm_1" });
    expect(calls.map((call) => call.host)).toEqual(["api.postmarkapp.com"]);
    expect(JSON.parse(calls[0].body)).toMatchObject({
      From: "Acme <security@acme.com>",
      To: "ada@example.com",
      Tag: "type:password-reset",
    });
  });

  test("falls back to SendGrid when Postmark returns a 503", async () => {
    postmarkStatus = 503;

    const result = await send.sendPasswordReset("ada@example.com", "https://acme.com/reset/abc");

    expect(result).toMatchObject({ adapter: "sendgrid", id: "sg_1" });
    expect(calls.map((call) => call.host)).toEqual(["api.postmarkapp.com", "api.sendgrid.com"]);
    expect(JSON.parse(calls[1].body)).toMatchObject({
      personalizations: [{ to: [{ email: "ada@example.com" }] }],
      subject: "Reset your Acme password",
      categories: ["password-reset"],
    });
  });

  test("a receipt with fallback turned off stops after Postmark fails", async () => {
    postmarkStatus = 503;

    const failure = await send.sendReceipt("ada@example.com", "ord_123").catch((error) => error);

    expect(failure).toBeInstanceOf(EmailRouteError);
    expect(calls.map((call) => call.host)).toEqual(["api.postmarkapp.com"]);
    expect(JSON.parse(calls[0].body)).toMatchObject({ Metadata: { orderId: "ord_123" } });
  });

  test("rejects a scheduled send before any request, because Postmark has no sendAt", async () => {
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
    expect(String(failure.message)).toContain("postmark");
    expect(calls).toEqual([]);
  });
});
```

Run it with `bun test src/email.test.ts`. All four tests pass against `@opencoredev/email-sdk` 3.0.1. They prove the routing and the main fields of each provider request. They don't prove delivery, which needs a real send from your own accounts.

## Related

- [Migrate from the SendGrid SDK](/docs/guides/migrate/sendgrid): keep SendGrid and replace direct Mail Send calls with Email SDK.
- [SendGrid adapter](/docs/adapters/sendgrid): options and field mapping.
- [Retries and fallback](/docs/concepts/fallbacks-and-retries): how delivery certainty decides when fallback runs.
- [Mailgun alternatives](/blog/mailgun-alternatives): the same migration, starting from Mailgun.
