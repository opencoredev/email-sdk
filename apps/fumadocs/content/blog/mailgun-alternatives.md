# Mailgun Alternatives for Developers, and How to Switch

Mailgun is a capable API, and it still supports every message field Email SDK models. Teams usually look elsewhere for narrower reasons: the free plan and Basic keep [one day of logs](https://www.mailgun.com/pricing/), the free plan caps you at 100 emails a day, or they want a different deliverability or support experience. The switch itself is the risky part, because a half-finished migration loses mail.

This post covers what to check in a replacement, a short sourced comparison, and a migration that keeps Mailgun as the fallback until the new provider has proven itself. It ends with complete code that passes its own tests.

## What to look for in a replacement

Start from your Mailgun integration, not from pricing pages. Mailgun's `h:`, `v:`, and `o:` form fields cover more than most providers do, and each one you use narrows the list.

- **Fields your code sends.** `v:` variables (metadata), `o:deliverytime` (scheduled send), and `o:tag` don't all exist elsewhere. The table below shows which providers can receive them.
- **Batch sends.** Mailgun's `recipient-variables` sends one personalized email per address in a single request. Email SDK's `sendPersonalized` keeps that behavior on Mailgun and SendGrid, and sends one request per recipient on providers without a native batch API.
- **Log retention.** Compare against what support actually needs. One day is short if a user writes in on Monday about a Friday email.
- **Region.** Mailgun EU domains live on `api.eu.mailgun.net`. If you chose the EU region for data residency, the replacement needs the same answer.
- **Duplicate protection.** A provider with native idempotency keys can safely retry a request that timed out. Mailgun doesn't have them, so check whether the new one does.
- **Suppressions and templates.** Export your [bounces, unsubscribes, and complaints](https://help.mailgun.com/hc/en-us/articles/360012287493-Suppressions-Bounces-Complaints-Unsubscribes-Allowlists) and load them into the new provider or your own do-not-send list. Stored Mailgun templates don't move, so plan to render HTML in your code.

## The realistic options

Every price below comes from the provider's own pricing page, checked October 29, 2026. Prices change, so follow the link before you commit.

| Provider | Free tier | Entry paid plan | Retention on entry plan |
| --- | --- | --- | --- |
| [Mailgun](https://www.mailgun.com/pricing/) (today) | 100 emails/day | Basic from $15/mo (10,000 emails) | 1 day of logs (5 on Foundation, 30 on Scale) |
| [Resend](https://resend.com/pricing) | 3,000 emails/month, 100/day | Pro $20/mo for 50,000, then $0.90 per 1,000 | 30 days of emails and logs |
| [Postmark](https://postmarkapp.com/pricing) | 100 emails/month, doesn't expire | Basic $15/mo for 10,000, then $1.80 per 1,000 | 45 days |
| [SendGrid](https://www.twilio.com/en-us/products/email-api/pricing) | 60-day trial, 100 emails/day | Essentials from $19.95/mo | 3 days of email activity |
| [Amazon SES](https://aws.amazon.com/ses/pricing/) | No SES free tier for new accounts since July 2026; new AWS customers get up to $200 in credits | Essentials plan $0.16 per 1,000, or à la carte $0.10 per 1,000 | Up to your own logging setup |
| [Lettermint](https://lettermint.co/pricing) | 300 emails/month | Starter €10/mo for 10,000 | 28 days of message history |

**Resend** has the largest free tier here and native idempotency keys, and it supports scheduled sends. It doesn't take per-message metadata, so `v:` variables need another home.

**Postmark** is built for transactional mail and keeps 45 days of history on Basic. It has no tier between 100 and 10,000 emails a month, and it has no scheduled send.

**SendGrid** matches Mailgun field for field, so it's the smallest code change. Its [free plan was retired in May 2025](https://www.twilio.com/en-us/changelog/sendgrid-free-plan), and Essentials keeps 3 days of activity.

**Amazon SES** is cheapest at volume, and you manage more yourself: bounce handling, reputation, and logging through configuration sets. AWS [moved new accounts to pricing plans](https://aws.amazon.com/blogs/messaging-and-targeting/introducing-amazon-simple-email-service-ses-pricing-plans/) on July 21, 2026, and the old 3,000-message SES free tier doesn't apply to them.

**Lettermint** processes and stores email data only in the EU, which makes it the direct answer if you chose Mailgun's EU region for residency. It has native idempotency keys and supports metadata.

### Which Mailgun fields survive the move

Mailgun supports all eight message fields that Email SDK models. This table comes from the SDK's adapter declarations and shows what each alternative can receive. A "No" means the SDK rejects that message before sending instead of silently dropping the field.

| Field | Mailgun | Resend | Postmark | SendGrid | Amazon SES | Lettermint |
| --- | --- | --- | --- | --- | --- | --- |
| CC, BCC, reply-to | Yes | Yes | Yes | Yes | Yes | Yes |
| Custom headers | Yes | Yes | Yes | Yes | Yes | Yes |
| Attachments | Yes | Yes | Yes | Yes | Yes | Yes |
| Tags | Yes | Yes | Yes (one per message) | Yes | Yes | Yes (one per message) |
| Metadata (`v:` variables) | Yes | No | Yes | Yes | No | Yes |
| Scheduled send (`sendAt`) | Yes | Yes | No | Yes | No | No |
| Native idempotency | No | Yes | No | No | No | Yes |

The full matrix lives on the [field support page](/docs/adapters/field-support). Adapter details are on the [Resend](/docs/adapters/resend), [Postmark](/docs/adapters/postmark), [SendGrid](/docs/adapters/sendgrid), [Amazon SES](/docs/adapters/ses), and [Lettermint](/docs/adapters/lettermint) pages. For a head-to-head, see [Resend vs Mailgun](/compare/resend-vs-mailgun), [Postmark vs Mailgun](/compare/postmark-vs-mailgun), [SendGrid vs Mailgun](/compare/sendgrid-vs-mailgun), or [Mailgun vs SES](/compare/mailgun-vs-ses).

## Migrate with Mailgun as the fallback

The plan below moves to Resend. Any adapter from the table works the same way: change the import and the options.

Email SDK puts both providers behind one client. Mailgun stays configured as the fallback, and one environment variable decides which provider goes first. Cutover and rollback are both config changes, not new code.

### 1. Prepare the new provider

Do this before any code ships. Verify your sending domain in Resend and publish the DNS records it gives you. Load the suppressions you exported from Mailgun. Keep Mailgun's DNS records in place, because Mailgun still sends whenever it's the primary or the fallback.

### 2. Configure both adapters

Install the SDK:

```bash
npm install @opencoredev/email-sdk
```

`src/email.ts` in the complete code at the end of this post registers both adapters. `defaultAdapter` reads `EMAIL_PRIMARY` and defaults to `mailgun`, so after you deploy this file the same provider keeps sending until you flip the variable. `MAILGUN_BASE_URL` is optional; set it to `https://api.eu.mailgun.net` for an EU domain. The fallback list names both providers. The SDK always skips whichever one is primary, so the other one is the backup in either direction.

Before any request leaves your server, the client checks the message against every adapter in its route, the fallback included. That check starts the day you deploy: a message with `metadata` throws `EmailValidationError`, even while Mailgun is still primary, because Resend has no metadata field. Before you deploy, run your real messages through `email.validate()` in a test. For a message type that has to keep that field, pass `fallback: { adapters: [] }` on its send until you've moved it. The receipt in `src/send.ts` moves its order id from metadata to a tag for that reason.

### 3. Decide which emails may fail over

A provider can return a 5xx or time out after it already accepted your message. The SDK marks those failures as delivery `unknown`, and by default it stops instead of trying the fallback, because the fallback could send a second copy. The [fallback guide](/docs/concepts/fallbacks-and-retries) explains the rule.

`onUnknownDelivery: "continue"` turns failover on for those failures. That's the right trade for a sign-in link, where a duplicate is harmless and a missing email locks someone out. It's the wrong trade for a receipt. `src/send.ts` passes `fallback: { adapters: [] }` on the receipt, so a failed receipt throws `EmailRouteError` instead of trying a second provider. That alone doesn't make a later retry safe: an `unknown` failure means the provider may already have sent it. Before your queue retries, look the message up in the provider's logs or delivery webhooks. With a provider that has native idempotency keys (Resend or Lettermint), pass the same `idempotencyKey` on every attempt so the provider can drop a repeat.

### 4. Cut over

Set `EMAIL_PRIMARY=resend` in one environment first. Watch Resend's logs and your error logs for a few days. To roll back, set `EMAIL_PRIMARY=mailgun`.

Once Resend has handled a full week of real traffic, remove the Mailgun adapter, its API key, and its DNS records. Keep a `fallback` with another provider if you want a standing backup.

### 5. Move webhooks

The SDK's [webhook helpers](/docs/reference/webhooks) verify and normalize both Mailgun and Resend delivery events. One handler can accept both providers during the cutover, and your bounce and complaint logic reads the same normalized event either way.

## Complete code

Three files. The first two are what you deploy. The third runs the migration against fake provider responses with `bun test`, so you can check the fallback behavior before you touch a real account.

`src/email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { mailgun } from "@opencoredev/email-sdk/mailgun";
import { resend } from "@opencoredev/email-sdk/resend";

const adapterNames = ["resend", "mailgun"] as const;

type AdapterName = (typeof adapterNames)[number];

function requireEnv(name: string): string {
  const value = process.env[name];

  if (!value) throw new Error(`Missing environment variable ${name}.`);

  return value;
}

function parsePrimary(value = "mailgun"): AdapterName {
  const name = adapterNames.find((candidate) => candidate === value);

  if (!name) throw new Error(`EMAIL_PRIMARY must be one of: ${adapterNames.join(", ")}.`);

  return name;
}

export const email = createEmailClient({
  adapters: [
    resend({ apiKey: requireEnv("RESEND_API_KEY") }),
    mailgun({
      apiKey: requireEnv("MAILGUN_API_KEY"),
      domain: requireEnv("MAILGUN_DOMAIN"),
      baseUrl: process.env.MAILGUN_BASE_URL,
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
    from: "Acme <login@mg.acme.com>",
    to,
    subject: "Your Acme sign-in link",
    text: `Sign in to Acme: ${loginUrl}\nThe link expires in 15 minutes.`,
    tags: [{ name: "type", value: "magic-link" }],
  });
}

export async function sendReceipt(to: string, orderId: string) {
  return await email.send(
    {
      from: "Acme <billing@mg.acme.com>",
      to,
      subject: `Your Acme receipt for order ${orderId}`,
      text: `Thanks for your order ${orderId}.`,
      tags: [{ name: "order", value: orderId }],
    },
    { fallback: { adapters: [] } },
  );
}
```

The test swaps `fetch` for a fake that answers like Resend and Mailgun, then checks four things: a normal send goes to Resend, a Resend 503 falls back to Mailgun, a receipt doesn't fall back, and a message with metadata is rejected before any request.

`src/email.test.ts`:

```ts
import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { EmailRouteError, EmailValidationError } from "@opencoredev/email-sdk";

const testEnv = {
  EMAIL_SDK_TELEMETRY: "0",
  RESEND_API_KEY: "re_test",
  MAILGUN_API_KEY: "test-mailgun-key",
  MAILGUN_DOMAIN: "mg.acme.com",
  MAILGUN_BASE_URL: "https://api.eu.mailgun.net",
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

  if (url === "https://api.eu.mailgun.net/v3/mg.acme.com/messages") {
    return Promise.resolve(Response.json({ id: "<mg_1@mg.acme.com>", message: "Queued. Thank you." }));
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

describe("Mailgun to Resend migration example", () => {
  test("sends through Resend when it accepts the message", async () => {
    const result = await send.sendMagicLink("ada@example.com", "https://acme.com/login/abc");

    expect(result).toMatchObject({ adapter: "resend", id: "re_1" });
    expect(calls.map((call) => call.host)).toEqual(["api.resend.com"]);
    expect(JSON.parse(String(calls[0].body))).toMatchObject({
      from: "Acme <login@mg.acme.com>",
      to: ["ada@example.com"],
      tags: [{ name: "type", value: "magic-link" }],
    });
  });

  test("falls back to Mailgun's EU endpoint when Resend returns a 503", async () => {
    resendStatus = 503;

    const result = await send.sendMagicLink("ada@example.com", "https://acme.com/login/abc");

    expect(result).toMatchObject({ adapter: "mailgun", id: "<mg_1@mg.acme.com>" });
    expect(calls.map((call) => call.host)).toEqual(["api.resend.com", "api.eu.mailgun.net"]);

    const form = calls[1].body;

    expect(form).toBeInstanceOf(FormData);

    if (!(form instanceof FormData)) return;

    expect(form.getAll("to")).toEqual(["ada@example.com"]);
    expect(form.get("subject")).toBe("Your Acme sign-in link");
    expect(form.getAll("o:tag")).toEqual(["magic-link"]);
  });

  test("a receipt with fallback turned off stops after Resend fails", async () => {
    resendStatus = 503;

    const failure = await send.sendReceipt("ada@example.com", "ord_123").catch((error) => error);

    expect(failure).toBeInstanceOf(EmailRouteError);
    expect(calls.map((call) => call.host)).toEqual(["api.resend.com"]);
    expect(JSON.parse(String(calls[0].body))).toMatchObject({
      tags: [{ name: "order", value: "ord_123" }],
    });
  });

  test("rejects Mailgun-style metadata before any request, because Resend has no metadata field", async () => {
    const failure = await client.email
      .send({
        from: "Acme <hello@mg.acme.com>",
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

Run it with `bun test src/email.test.ts`. All four tests pass against `@opencoredev/email-sdk` 3.0.1. They prove the routing and the main fields of each provider request. They don't prove delivery, which needs a real send from your own accounts.

## Related

- [Mailgun adapter](/docs/adapters/mailgun): options, EU region, field mapping, and native batch sends.
- [Mailgun API guide for Node.js and TypeScript](/blog/mailgun-api-nodejs-typescript): raw requests, regions, rate limits, and webhooks.
- [Retries and fallback](/docs/concepts/fallbacks-and-retries): how delivery certainty decides when fallback runs.
- [SendGrid alternatives](/blog/sendgrid-alternatives): the same migration, starting from SendGrid.
