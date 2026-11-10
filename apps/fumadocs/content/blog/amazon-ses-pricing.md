# Amazon SES Pricing in 2026: Plans and Real Costs

A new Amazon SES account pays $0.16 per 1,000 emails on the Essentials plan, with no monthly fee. You can switch to à la carte pricing at $0.10 per 1,000 at any time. Both add $0.12 per GB of outgoing message data. AWS's pricing page no longer lists the old 3,000-message SES free tier. New AWS customers get up to $200 in AWS Free Tier credits instead, usable on SES and other services within 12 months of opening the account. Every number on this page comes from [aws.amazon.com/ses/pricing](https://aws.amazon.com/ses/pricing/), checked November 2026. Prices change, so confirm them there before you commit.

This page covers which pricing applies to your account, what each plan costs, the line items that grow a bill past the headline rate, what SES costs next to Resend and Postmark, and how to keep tests from sending billable email. The code is near the end, under "Send through SES from Node.js".

## Which pricing applies to you

Your account's history decides where you start, not a choice at sign-up. AWS [introduced pricing plans](https://aws.amazon.com/blogs/messaging-and-targeting/introducing-amazon-simple-email-service-ses-pricing-plans/) on July 21, 2026:

- **New accounts, and account and region pairs with no metered SES activity since June 1, 2025,** start on the Essentials plan.
- **Accounts that were already sending** keep à la carte pricing unless they choose a plan.
- **Anyone can switch.** Upgrades apply right away. If you were put on Essentials by default, your first switch to à la carte also applies right away. Other downgrades wait for the next billing cycle.

Plans and rates apply per account and per region. An app that sends from two regions is billed for each one separately.

## Pricing plans

| Plan | Per 1,000 emails | Monthly fee |
| --- | --- | --- |
| Essentials | $0.16 | none |
| Pro | $0.22 | $105 |
| Enterprise | $0.23 | $500 |

Those rates cover the first 10 million emails a month. From 10 to 100 million they drop to $0.14, $0.17 and $0.18, and above 100 million to $0.11, $0.12 and $0.13. Tiers are marginal: each rate applies only to the emails inside its tier. Outbound email is charged per recipient, so a message to three addresses costs three emails.

Every plan includes sending through the API, SMTP or an AWS SDK, plus Virtual Deliverability Manager (VDM) SES deliverability: delivery and engagement metrics and reputation recommendations. Pro adds managed dedicated IPs, email validation and VDM global deliverability. Enterprise adds Global Endpoints (sending spread across two regions), Tenants and an open ingress endpoint for inbound mail. Standard dedicated IPs and bring-your-own IPs are paid add-ons on every plan.

## À la carte pricing

À la carte bills each feature separately. These are the lines a transactional sender usually meets ([SES pricing](https://aws.amazon.com/ses/pricing/), checked Nov 2026):

| Item | Price |
| --- | --- |
| Outbound email | $0.10 per 1,000 emails |
| Outgoing message data | $0.12 per GB |
| VDM SES deliverability | $0.07 per 1,000 emails (first 10 million) |
| Dedicated IPs, standard | $24.95 per IP per month |
| Dedicated IPs, managed | $15 per month, plus $0.08 per 1,000 emails (first 10 million) |
| Global Endpoints | $0.03 per 1,000 emails, on top of sending |
| Email validation | $0.01 per address checked by API; $0.01 per 1,000 for auto validation |
| Inbound email | $0.10 per 1,000 emails, plus $0.09 per 1,000 incoming 256 KB chunks |

**Essentials or à la carte?** Essentials' $0.16 already includes VDM. À la carte sending plus VDM comes to $0.17 per 1,000, so Essentials is cheaper if you want VDM. If you don't, à la carte is $0.06 per 1,000 cheaper: about $60 a month at a million emails. For most transactional apps that don't need VDM's dashboards, switching to à la carte is the cheapest setup SES offers.

## What SES costs at your volume

This table applies the published rates to messages averaging 32 KB, the size AWS uses in its own examples, with no add-ons and no credits:

| Emails per month | Essentials | À la carte |
| --- | --- | --- |
| 10,000 | $1.64 | $1.04 |
| 100,000 | $16.38 | $10.38 |
| 1,000,000 | $163.84 | $103.84 |
| 10,000,000 | $1,638.40 | $1,038.40 |

Data adds about $0.38 per 100,000 emails at 32 KB. It grows with attachments: 100,000 emails carrying a 1 MB PDF each is about 100 GB, or $12 in data on top of sending.

## What makes an SES bill bigger

The rate per 1,000 is rarely the whole bill. Check these before you budget:

- **Recipients, not messages.** Every address in To, Cc and Bcc counts as one email.
- **Test sends.** Emails to the SES mailbox simulator are billed at the outbound rate, so a test suite that sends through SES costs money on every run.
- **Dedicated IPs.** A standard dedicated IP is $24.95 a month, more than the sending charge for 150,000 emails on Essentials. Shared IPs are the default, and most transactional senders don't need their own.
- **Inbound and Mail Manager.** Receiving costs $0.10 per 1,000 plus chunk fees. A Mail Manager open or mTLS ingress endpoint is $50 a month, and AWS keeps charging while it's "Closed". Delete it to stop the charge.
- **Other AWS services.** SES publishes bounces, complaints and deliveries through configuration-set event destinations such as SNS, EventBridge, Firehose or CloudWatch. Those services and any S3 storage for received mail bill separately.
- **Regions.** Plans, dedicated IPs and Mail Manager endpoints are per region, so a second region repeats those fixed costs.

SES also starts every account in the sandbox: you can send only to verified addresses, at most 200 messages per 24 hours and 1 per second, until AWS approves your [production access request](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html). Ask for it a few days before launch.

## Is SES the cheapest transactional email API?

On the per-email rate, usually yes. Here is the same volume on [Resend](https://resend.com/pricing) and [Postmark](https://postmarkapp.com/pricing), from their own pricing pages (checked Nov 2026), with SES at 32 KB per message:

- **3,000 a month, at most 100 a day:** SES $0.31 à la carte or $0.49 on Essentials. Resend Free is $0. Postmark Basic is $15 (Postmark's free plan stops at 100 a month).
- **10,000 a month:** SES $1.04 à la carte or $1.64 on Essentials. Resend Pro is $20. Postmark Basic is $15.
- **100,000 a month:** SES $10.38 or $16.38. Resend Pro is $35.
- **1,000,000 a month:** SES $103.84 or $163.84. Resend Scale is $650.

Postmark prices higher volumes on its pricing page, so check it for your number.

What the lower bill leaves to you: SES has no idempotency keys and no scheduled send, events reach you through AWS services rather than plain HTTP webhooks, and you handle bounce and complaint rates yourself. Below a few hundred thousand emails a month, the price gap is often smaller than the time that work takes. [Resend pricing](/blog/resend-pricing) has Resend's full tiers, and [Resend vs Amazon SES](/compare/resend-vs-ses) compares the fields each provider accepts.

## Send through SES from Node.js

Email SDK's SES adapter calls the SES v2 `SendEmail` API with plain `fetch` and signs requests with AWS Signature V4 itself, so you don't install the AWS SDK. The same client takes a memory adapter in tests, so test runs never reach SES or its mailbox simulator:

`email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { ses } from "@opencoredev/email-sdk/ses";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";

const isTest = process.env.NODE_ENV === "test";

export const memory = memoryAdapter();

export const email = createEmailClient({
  adapters: [
    isTest
      ? memory
      : ses({
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
          region: process.env.AWS_REGION!,
        }),
  ],
});
```

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

Run it with `NODE_ENV=test bun test`. No request reaches AWS, so the run costs nothing.

## A second provider when SES throttles

When you pass your SES sending rate, the API answers `429`. The SES adapter reports a `429`, a timeout, a network error or a 5xx as delivery `"unknown"`, because SES may already have accepted the message. A definite rejection such as a `400` or `403` is `"not_sent"` and falls back by default. The default `onUnknownDelivery: "stop"` throws on an unknown failure instead of trying the fallback. To let a throttled password reset go out through another provider, opt in and accept that an uncertain failure could send it twice:

`email-with-fallback.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";
import { ses } from "@opencoredev/email-sdk/ses";

export const email = createEmailClient({
  adapters: [
    ses({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      region: process.env.AWS_REGION!,
    }),
    resend({ apiKey: process.env.RESEND_API_KEY! }),
  ],
  defaultAdapter: "ses",
  fallback: { adapters: ["resend"], onUnknownDelivery: "continue" },
});
```

[Retries and fallback](/docs/concepts/fallbacks-and-retries) explains the trade-off, and the [SES adapter reference](/docs/adapters/ses) lists every option, including `sessionToken` for IAM roles and `configurationSetName` for event publishing. [Resend alternatives](/blog/resend-alternatives) walks through a full move to SES with Resend kept as the fallback.

The code on this page was typechecked against `@opencoredev/email-sdk` 3.0.1, and the test ran with `bun test`. No real email was sent.

## FAQ

**How much does Amazon SES cost per 1,000 emails?** $0.16 on the Essentials plan, which new accounts start on, or $0.10 on à la carte pricing. Both add $0.12 per GB of message data.

**Is Amazon SES free?** Not for new accounts. AWS's pricing page lists no SES free tier. New AWS customers get up to $200 in Free Tier credits that also cover SES, and they expire 12 months after the account opens.

**Can I go back to $0.10 per 1,000 after being put on Essentials?** Yes. If Essentials was applied by default, your first switch to à la carte takes effect immediately.

**Does SES charge for test emails?** Yes, mailbox simulator sends are billed like outbound email. Use a memory adapter or a local SMTP inbox in tests instead.

## Related

- [Resend vs Amazon SES](/compare/resend-vs-ses), [SendGrid vs Amazon SES](/compare/sendgrid-vs-ses), [Mailgun vs Amazon SES](/compare/mailgun-vs-ses) and [Postmark vs Amazon SES](/compare/postmark-vs-ses): field support next to other providers.
- [Resend pricing](/blog/resend-pricing): Resend's plans, the free tier's daily cap, and overage rates.
- [Resend alternatives](/blog/resend-alternatives): move from Resend to SES with Resend as the fallback.
- [SendGrid alternatives](/blog/sendgrid-alternatives): sourced prices for other providers.
- [Amazon SES adapter reference](/docs/adapters/ses): adapter options and field mapping.
