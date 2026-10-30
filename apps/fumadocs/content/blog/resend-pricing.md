# Resend Pricing: Free Tier, Pro, Scale and Overage

Resend's free plan costs $0 and includes 3,000 transactional emails a month, capped at 100 a day. Paid sending plans start at $20 a month for 50,000 emails (Pro), and Scale starts at $90 a month for 100,000. Paid plans can keep sending past their quota at $0.46 to $0.90 per extra 1,000 emails, depending on the tier. Every number on this page comes from [resend.com/pricing](https://resend.com/pricing) and Resend's [usage limits docs](https://resend.com/docs/api-reference/rate-limit), checked October 2026. Prices change, so confirm them there before you buy.

This page covers what each plan includes, what counts against the quota, what happens when you run out, and how to keep tests and CI from spending it. Want code? The [Resend API guide for Node.js and TypeScript](/blog/resend-api-nodejs-typescript) shows the API calls.

## Transactional plans

Resend bills transactional email (the `/emails` API) separately from marketing email (Broadcasts). This table lists the transactional tiers ([Resend pricing](https://resend.com/pricing), checked Oct 2026):

| Plan | Price per month | Emails per month | Extra emails, per 1,000 | Daily limit | Domains |
| --- | --- | --- | --- | --- | --- |
| Free | $0 | 3,000 | none (hard cap) | 100 | 3 |
| Pro | $20 | 50,000 | $0.90 | none | 10 |
| Pro | $35 | 100,000 | $0.90 | none | 10 |
| Scale | $90 | 100,000 | $0.90 | none | 1,000 |
| Scale | $160 | 200,000 | $0.80 | none | 1,000 |
| Scale | $350 | 500,000 | $0.70 | none | 1,000 |
| Scale | $650 | 1,000,000 | $0.65 | none | 1,000 |
| Scale | $825 | 1,500,000 | $0.52 | none | 1,000 |
| Scale | $1,150 | 2,500,000 | $0.46 | none | 1,000 |
| Enterprise | custom | custom | custom | none | by contract |

Free, Pro and Scale keep 30 days of email logs; Enterprise retention is set by contract. Free gets 1 webhook endpoint, Pro 5 and Scale 10. Scale also adds a dedicated Slack channel, and it's the plan that can buy a dedicated IP and single sign-on. Billing is monthly only: Resend has no annual plans and no annual discount. Registered nonprofits can apply for 50% off paid plans.

Every plan includes the REST API, the SMTP relay, the official SDKs, inbound email, scheduled sending, batch sending, open and link tracking, and DKIM, SPF and DMARC authentication. Open and click tracking also work on Free.

## The free tier in detail

The free plan is free forever, not a trial (Resend has no trial). The limits that matter in practice:

- **3,000 emails a month and 100 a day.** The daily cap is a UTC calendar day: it resets at 00:00 UTC, not 24 hours after your first send. Only the Free plan has a daily cap. Paid plans only have the monthly quota.
- **No overage.** Free can't use pay-as-you-go, so email 101 of the day fails instead of costing money.
- **3 custom domains and 3 inboxes.**
- **1 webhook endpoint.** One endpoint can receive every event type, so this is enough for most single-app setups.

Free suits side projects, staging, and an app's first users. A product that sends a welcome email and a few password resets per signup reaches 100 a day quickly on a launch day, and those emails then fail until midnight UTC.

## What counts as an email

Resend's pricing page and usage-limits docs list what draws from the transactional quota:

- Each recipient of an `/emails` send counts as one email. A message to three addresses uses three.
- Received email counts too. Every inbound message, and every email sent or received through a Resend Inbox, uses the same transactional quota. Turning on inbound handling for a busy support address can use more quota than your outgoing mail.
- Broadcasts don't count. Emails sent through the `/broadcasts` API or the Broadcasts dashboard draw from the marketing plan, which is priced by contacts instead.

## What happens when you run out

When you pass a limit, the send API answers with a `429` and one of two error types ([Usage limits](https://resend.com/docs/api-reference/rate-limit), checked Oct 2026):

| Error | When | What to do |
| --- | --- | --- |
| `daily_quota_exceeded` | Free plan, 100 emails in the current UTC day | Wait for 00:00 UTC or upgrade |
| `monthly_quota_exceeded` | Monthly quota used up, without pay-as-you-go | Upgrade, or enable pay-as-you-go on a paid plan |

On a paid plan, pay-as-you-go lets you keep sending past the quota. Resend charges your plan's overage rate per bucket of 1,000 extra emails. It's off by default: you turn it on under "Transactional Overages" in team settings. With it off, Resend notifies you and offers an upgrade.

The API also sets two headers on every response, so you can watch usage before you hit the wall: `x-resend-monthly-quota` (used monthly quota) and, on Free only, `x-resend-daily-quota` (used daily quota).

Upgrading doesn't change the API rate limit. It's 10 requests per second per team on every plan, shared by all of the team's API keys, and returns `429 rate_limit_exceeded` when you pass it. The batch endpoint sends up to 100 emails per request and counts as one request, which is the usual way to stay under it. Resend raises the limit for trusted senders on request.

## Which plan is cheapest at your volume

Overage changes which plan wins, because Pro charges the same $0.90 per extra 1,000 as the smallest Scale tier. This table applies the published rates, assuming pay-as-you-go is on and every recipient counts as one email:

| Emails per month | Cheapest listed option | Monthly cost |
| --- | --- | --- |
| 3,000 or fewer, max 100 a day | Free | $0 |
| 50,000 | Pro $20 | $20 |
| 100,000 | Pro $35 | $35 |
| 150,000 | Pro $35 + 50 × $0.90 | $80 |
| 300,000 | Pro $35 + 200 × $0.90 | $215 |
| 500,000 | Scale $350 | $350 |
| 1,000,000 | Scale $650 | $650 |

Pro with overage stays cheaper than the Scale tiers up to about 450,000 emails a month. Pick Scale earlier when you need what Pro lacks: more than 10 domains, a dedicated IP, SSO, or more webhook endpoints. Pro and Scale can also add 100 domains for $20 a month.

## Marketing plans

Broadcasts are priced by stored contacts, not by emails sent ([Resend pricing](https://resend.com/pricing), checked Oct 2026):

| Plan | Price per month | Contacts |
| --- | --- | --- |
| Free | $0 | 1,000 |
| Pro marketing | $40 | 5,000 |
| Pro marketing | $80 | 10,000 |
| Pro marketing | $120 | 15,000 |
| Pro marketing | $180 | 25,000 |
| Pro marketing | $250 | 50,000 |
| Pro marketing | $450 | 100,000 |
| Pro marketing | $650 | 150,000 |

Broadcasts only go to existing contacts. Past the contact limit you can still add contacts, but sending a broadcast fails with a `403` until you upgrade or remove some. You can also send a newsletter through `/emails` instead, in which case each recipient counts against the transactional quota and you add the unsubscribe link and `List-Unsubscribe` headers yourself.

## Add-ons

| Add-on | Price | Available on |
| --- | --- | --- |
| 100 extra domains | $20 / month | Pro, Scale |
| Dedicated IP | $30 / month | Scale, for senders above 3,000 emails a day |
| Single sign-on | $150 / month | Scale (included on Enterprise) |
| Extra inbox | $1 / inbox / month | Paid plans with pay-as-you-go |
| Automation runs past 10,000 a month | $0.0015 / run | Paid plans with pay-as-you-go |

## Keep tests and CI off the quota

On Free, 100 emails a day is easy to spend from a test suite or a busy staging server. Resend's [test addresses](https://resend.com/docs/dashboard/emails/send-test-emails), such as `delivered@resend.dev`, avoid bounces against real inboxes. They still go through the API, so the safe default is for tests not to call Resend at all.

Email SDK's `memoryAdapter` records messages instead of sending them. Point production at the `resend` adapter and tests at the memory adapter, and the code that sends doesn't change:

`email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";

const isTest = process.env.NODE_ENV === "test";

export const memory = memoryAdapter();

export const email = createEmailClient({
  adapters: [isTest ? memory : resend({ apiKey: process.env.RESEND_API_KEY! })],
});
```

`signup.test.ts`:

```ts
import { expect, test } from "bun:test";

import { email, memory } from "./email";

test("signup sends one welcome email", async () => {
  await email.send({
    from: "Acme <hello@acme.com>",
    to: "ada@example.com",
    subject: "Welcome to Acme",
    text: "Thanks for signing up.",
  });

  expect(memory.raw?.sent).toHaveLength(1);
  expect(memory.raw?.sent[0]?.message.subject).toBe("Welcome to Acme");
});
```

Run it with `NODE_ENV=test bun test`. No request reaches Resend, so the run costs no quota.

## A second provider for quota errors

A quota `429` stops the email unless something else can send it. With Email SDK you can list a second provider as a fallback. Be exact about how it behaves: the Resend adapter reports every failed request, including a `429`, as delivery `"unknown"`, because it can't prove Resend never accepted the message. The default `onUnknownDelivery: "stop"` then throws instead of trying the fallback. To let a quota error move to the next provider, opt in and accept that an uncertain failure could produce a duplicate:

`email-with-fallback.ts`:

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
  fallback: { adapters: ["postmark"], onUnknownDelivery: "continue" },
});
```

[Retries and fallback](/docs/concepts/fallbacks-and-retries) covers the trade-off, and the [Resend adapter reference](/docs/adapters/resend) lists every option. A fallback is no substitute for the right plan. It keeps password resets flowing on the day you outgrow one.

The code on this page was typechecked against `@opencoredev/email-sdk` 3.0.1, and the test ran with `bun test`. No real email was sent.

## Related

- [Resend API guide for Node.js and TypeScript](/blog/resend-api-nodejs-typescript): API keys, idempotency keys, rate-limit retries, and webhooks.
- [Resend vs Postmark](/compare/resend-vs-postmark), [Resend vs SendGrid](/compare/resend-vs-sendgrid) and [Resend vs Amazon SES](/compare/resend-vs-ses): field support next to other providers.
- [SendGrid alternatives](/blog/sendgrid-alternatives): sourced prices for other providers.
- [Resend adapter reference](/docs/adapters/resend): adapter options and CLI checks.
