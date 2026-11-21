---
title: "Email API Pricing Compared: Cheapest Options in 2026"
description: "Email API pricing compared, checked November 2026: Amazon SES, Resend, SendGrid, Mailgun and Postmark from 3,000 to 1 million emails a month, plus free tiers."
type: blog
date: 2026-11-17
lastModified: 2026-11-17
search:
  tags: ["Pricing", "Transactional email", "Amazon SES"]
---

Amazon SES is the cheapest transactional email API at every volume once you pass a free tier: $0.10 per 1,000 emails on à la carte pricing, or $0.16 on the Essentials plan that new accounts start on. Below 3,000 emails a month and 100 a day, Resend Free and Mailgun Free cost nothing. Among the others, Mailgun and Postmark start at $15 for 10,000 emails, SendGrid and Resend cost about $20 for 50,000 and $35 for 100,000, and Resend is cheapest at 500,000 and 1 million. Every price on this page comes from the provider's own pricing page, checked November 2026: [Amazon SES](https://aws.amazon.com/ses/pricing/), [Resend](https://resend.com/pricing), [SendGrid](https://www.twilio.com/en-us/products/email-api/pricing), [Mailgun](https://www.mailgun.com/pricing/) and [Postmark](https://postmarkapp.com/pricing). Prices change, so confirm them there before you commit.

This page compares those five providers on monthly cost from 3,000 to 1 million emails, on what each free tier really allows, and on the costs a headline rate leaves out. The code near the end sends through SES from Node.js with a free Resend account as the fallback, and keeps tests off every paid API.

## Monthly cost at each volume

Each cell is the cheapest published option for that provider at that volume, with no add-ons, taxes or credits.

Amazon SES, with 32 KB messages (the size AWS uses in its own examples), so each total includes $0.12 per GB of message data:

| Emails per month | À la carte | Essentials |
| ---------------- | ---------- | ---------- |
| 3,000            | $0.31      | $0.49      |
| 10,000           | $1.04      | $1.64      |
| 50,000           | $5.19      | $8.19      |
| 100,000          | $10.38     | $16.38     |
| 500,000          | $51.92     | $81.92     |
| 1,000,000        | $103.84    | $163.84    |

Resend and SendGrid:

| Emails per month | Resend | SendGrid |
| ---------------- | ------ | -------- |
| 3,000            | $0     | $19.95   |
| 10,000           | $20    | $19.95   |
| 50,000           | $20    | $19.95   |
| 100,000          | $35    | $34.95   |
| 500,000          | $350   | $386.95  |
| 1,000,000        | $650   | $733     |

Mailgun and Postmark:

| Emails per month | Mailgun | Postmark |
| ---------------- | ------- | -------- |
| 3,000            | $0      | $15      |
| 10,000           | $15     | $15      |
| 50,000           | $35     | $55      |
| 100,000          | $75     | $115     |
| 500,000          | $400    | $455     |
| 1,000,000        | $700    | $775     |

The 3,000 row assumes at most 100 a day, the daily cap on Resend Free and Mailgun Free. SendGrid's 60-day trial also sends 100 a day for $0, then needs a paid plan.

Where the cheapest option isn't a plain plan price:

- **SendGrid** at 500,000 is Essentials 100K ($34.95) plus 400,000 extra emails at $0.88 per 1,000. At 1 million it's Pro 700K ($499) plus 300,000 extra at $0.78.
- **Mailgun** at 100,000 is the 100,000-email Foundation plan from its volume selector. At 500,000 and 1 million it's the Scale plan at that volume, which the selector prices below Foundation plus overage.
- **Postmark** prices volume in steps on its pricing slider: Basic is $15 for 10,000, $55 for 50,000, $115 for 125,000, $455 for 700,000 and $775 for 1.5 million. At 100,000 the 125,000 step is cheaper than the 50,000 step plus $1.80 per extra 1,000, and at 1 million the 1.5 million step beats 700,000 plus overage. Postmark's Pro and Platform plans cost slightly more per step and add inbound processing and longer retention options.
- **Resend** at 500,000 and 1 million is its Scale plan at that volume. Pro plus pay-as-you-go overage at $0.90 per 1,000 stays cheaper up to about 450,000 emails a month.

Every provider here counts each recipient as one email, so a message to three addresses costs three.

## Free tiers compared

| Provider   | Free allowance         | Limits                                                                  |
| ---------- | ---------------------- | ----------------------------------------------------------------------- |
| Resend     | 3,000 a month, forever | 100 a day (resets at 00:00 UTC), no overage, 3 domains                  |
| Mailgun    | 100 a day, forever     | 1 sending domain, 1 day of logs                                         |
| Postmark   | 100 a month, forever   | no overage                                                              |
| SendGrid   | 100 a day for 60 days  | trial only, then a paid plan                                            |
| Amazon SES | none                   | new AWS customers get up to $200 in AWS Free Tier credits for 12 months |

SendGrid [retired its free plan in May 2025](https://www.twilio.com/en-us/changelog/sendgrid-free-plan). SES no longer lists a free tier: AWS moved new accounts to pricing plans on July 21, 2026, and the old 3,000-message allowance and the 62,000 free emails from EC2 are gone from its pricing page. Older comparisons still quote both.

For a side project that sends under 100 emails a day, Resend Free or Mailgun Free is the cheapest option that needs no AWS account. A launch day can pass 100 quickly, though: welcome emails, confirmations and password resets add up, and on Resend Free email 101 of the day fails until midnight UTC.

## Why the cheapest API isn't always the cheapest choice

SES costs a fraction of everything else at volume because it sells sending and leaves most of the rest to you. Before you pick on price alone, count what you'd build or pay for elsewhere:

- **Logs and event history.** Resend keeps 30 days of logs on Free, Pro and Scale (Enterprise retention is set by contract), and Postmark 45 days on paid plans. SendGrid Essentials keeps 3 days of activity and Pro 7. Mailgun keeps 1 day on Free and Basic, 5 on Foundation and 30 on Scale. On SES, the Essentials plan includes Virtual Deliverability Manager, which keeps 30 days of searchable message history ([VDM dashboard](https://docs.aws.amazon.com/ses/latest/dg/vdm-dashboard.html)); on à la carte pricing VDM costs $0.07 per 1,000 extra. Longer history means publishing events to SNS, EventBridge, Firehose or CloudWatch and storing them yourself, and those services bill separately.
- **Sandbox and setup.** A new SES account starts in the sandbox, where it can send only to verified addresses and domains or the SES mailbox simulator, until AWS approves [production access](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html). A new Mailgun account starts on a sandbox domain limited to 5 authorized recipients.
- **Plan defaults.** A new SES account starts on Essentials at $0.16 per 1,000, which includes Virtual Deliverability Manager. À la carte is $0.10, and AWS lets you switch to it at any time.
- **Test sends.** SES bills mailbox simulator sends like real email, and Mailgun bills messages sent with test mode. A CI suite that calls either API on every run costs money.
- **Inbound mail.** Resend counts every received email against the same transactional quota as sent email. SES charges $0.10 per 1,000 received emails plus chunk fees.
- **Dedicated IPs.** A dedicated IP costs $24.95 a month on SES, $30 on Resend Scale and $59 for an extra one on Mailgun. Postmark's start at $50 a month, on its Pro and Platform plans, for senders of at least 300,000 emails a month. Most transactional senders do fine on shared IPs.

At 100,000 emails a month, SES à la carte is $25 to $105 a month cheaper than the managed APIs here, which can be less than the time it takes to build the logging and bounce handling yourself. The gap grows with volume: at 1 million emails it's about $550 to $670 a month.

## Send through SES from Node.js, with a free fallback

Email SDK's SES adapter calls the SES v2 `SendEmail` API with plain `fetch` and signs each request with AWS Signature V4 itself, so you don't install the AWS SDK. This client sends through SES and keeps a free Resend account as the fallback, which costs $0 while it waits:

`email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";
import { ses } from "@opencoredev/email-sdk/ses";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";

const isTest = process.env.NODE_ENV === "test";

export const memory = memoryAdapter();

export const email = isTest
  ? createEmailClient({ adapters: [memory] })
  : createEmailClient({
      adapters: [
        ses({
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
          region: process.env.AWS_REGION!,
        }),
        resend({ apiKey: process.env.RESEND_API_KEY! }),
      ],
      defaultAdapter: "ses",
      fallback: { adapters: ["resend"] },
    });
```

By default, the fallback runs only when SES definitely didn't send, such as a `400` or `403`. A `429`, a 5xx or a network error makes delivery `"unknown"`, because SES may already have accepted the message, and the default `onUnknownDelivery: "stop"` throws instead of trying Resend. Set `fallback: { adapters: ["resend"], onUnknownDelivery: "continue" }` to fall back on those too, and accept that an uncertain failure could send the email twice. [Retries and fallback](/docs/concepts/fallbacks-and-retries) explains the trade-off.

Three limits come with the free fallback. Resend Free stops at 100 emails a day, so a long SES outage on a busy app would pass it. The `from` domain has to be verified in both SES and Resend. And the client checks every adapter on the route before sending, so a message that Resend can't take, such as one that repeats a header name, fails validation before SES is called.

In tests, the memory adapter records each message instead of calling SES or Resend, so the suite costs nothing:

`welcome.test.ts`:

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

Run it with `NODE_ENV=test bun test`. Moving to another provider later means changing the adapter list, not the `email.send` calls. The [SES adapter reference](/docs/adapters/ses) and [Resend adapter reference](/docs/adapters/resend) list every option.

The code on this page was typechecked against `@opencoredev/email-sdk` 3.0.1, and the test ran with `bun test`. No real email was sent.

## FAQ

**What is the cheapest transactional email API?** Amazon SES, at $0.10 per 1,000 emails on à la carte pricing plus $0.12 per GB of message data. New accounts start on the Essentials plan at $0.16 per 1,000 and can switch.

**What is the cheapest way to send transactional email from Node.js?** Under 100 emails a day, Resend Free or Mailgun Free at $0. Above that, SES: about $1.04 for 10,000 emails and $10.38 for 100,000 on à la carte pricing, sent with any SES client for Node.js, including Email SDK's SES adapter.

**Is there a free email API without a trial limit?** Resend Free (3,000 a month, 100 a day), Mailgun Free (100 a day) and Postmark's free plan (100 a month) don't expire. SendGrid's free option is a 60-day trial, and SES has no free tier for new accounts.

**Which email API is cheapest at 100,000 emails a month?** SES, at $10.38 à la carte or $16.38 on Essentials. Among managed APIs, SendGrid Essentials ($34.95) and Resend Pro ($35) cost the same within a dollar, then Mailgun Foundation ($75) and Postmark Basic ($115).

## Related

- [Amazon SES pricing](/blog/amazon-ses-pricing): Essentials, Pro and à la carte rates, and what grows an SES bill.
- [Resend pricing](/blog/resend-pricing): every Resend tier, the free plan's daily cap and overage.
- [SendGrid pricing](/blog/sendgrid-pricing): the trial, Essentials and Pro plans, and break-even points.
- [Mailgun pricing](/blog/mailgun-pricing): Mailgun's plans, overage rates and log retention.
- [Resend alternatives](/blog/resend-alternatives), [SendGrid alternatives](/blog/sendgrid-alternatives) and [Mailgun alternatives](/blog/mailgun-alternatives): switching with the old provider kept as the fallback.
- [Compare email providers](/compare): message field support, pair by pair.
