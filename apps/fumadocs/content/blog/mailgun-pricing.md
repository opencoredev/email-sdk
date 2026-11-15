# Mailgun Pricing in 2026: Plans, Overage and Real Costs

Mailgun has four self-serve plans. Free costs $0 and sends 100 emails a day. Basic starts at $15 a month for 10,000 emails, Foundation at $35 for 50,000, and Scale at $90 for 100,000. Past the included volume, each extra 1,000 emails costs from $1.80 on Basic, $1.30 on Foundation and $1.10 on Scale. Enterprise is quote-only. Every number on this page comes from [mailgun.com/pricing](https://www.mailgun.com/pricing/), checked November 2026. Prices change, so confirm them there before you commit.

This page covers what each plan includes, which plan is cheapest at your volume, the limits that matter more than price for an app (log retention most of all), what Mailgun costs next to Resend, Postmark and Amazon SES, and how to keep tests from sending billable email. The code is near the end, under "Send through Mailgun from Node.js".

## Mailgun plans

| Plan | Per month | Extra per 1,000 |
| --- | --- | --- |
| Free | $0, 100 a day | none |
| Basic | $15 for 10,000 | $1.80 |
| Foundation | $35 for 50,000 | $1.30 |
| Scale | $90 for 100,000 | $1.10 |

Prices and overage rates are Mailgun's "from" figures.

Mailgun's volume selector also offers Foundation and Scale at larger volumes (250,000 up to 2.5 million a month). Pick your volume there to see those prices, because a bigger plan is often cheaper than paying overage on a smaller one. Foundation and Scale are free for the first month. Mailgun bills overage at the start of each month for the month before.

What changes between the plans, beyond volume:

- **Free:** 1 day of logs, 1 sending domain, 1 inbound route, 1 user, 1 API key.
- **Basic:** 1 day of logs, 1 sending domain, 5 inbound routes, 1 API key.
- **Foundation:** 5 days of logs, 1,000 sending domains, full inbound routing, unlimited users, and a dedicated IP from 50,000 emails a month.
- **Scale:** 30 days of logs, 1,000 sending domains, unlimited users, and one dedicated IP included.

 Scale adds live phone and chat support, SAML SSO, send time optimization, dedicated IP pools and 5,000 email validations. An extra dedicated IP is $59 a month. Email validation beyond what a plan includes costs from $1.20 per 100 on Basic and Foundation and from $0.80 per 100 on Scale.

## Which plan is cheapest at your volume

This table applies the listed starting prices and overage rates, with no add-ons:

| Emails per month | Basic | Foundation | Scale |
| --- | --- | --- | --- |
| 10,000 | $15 | $35 | $90 |
| 25,000 | $42 | $35 | $90 |
| 50,000 | $87 | $35 | $90 |
| 100,000 | $177 | $100 | $90 |

Basic overtakes Foundation at about 21,100 emails a month: $15 plus 11.1 thousand extra emails at $1.80 comes to $35. If you send more than that, Foundation is cheaper, and it also brings 5 days of logs. Scale overtakes Foundation at about 92,300 a month, where $35 plus 42.3 thousand extra emails at $1.30 also comes to $90. Above 100,000, compare the selector's larger plans against overage before you choose.

## The limits that matter more than price

For an app that sends receipts, resets and invites, a few plan limits affect your users more than the monthly bill:

- **Log retention.** Free and Basic keep one day of logs. If a user writes in on Monday about a Friday email that never arrived, the record is gone. Foundation keeps 5 days and Scale 30. If you stay on Basic, store Mailgun's webhook events yourself.
- **One sending domain.** Free and Basic allow one custom sending domain. An app that sends from `mail.example.com` and a second brand's domain needs Foundation.
- **The sandbox domain.** A new account gets a sandbox domain that sends only to up to 5 authorized recipients ([Sandbox domain](https://documentation.mailgun.com/docs/mailgun/user-manual/domains/domains-sandbox), checked Oct 2026). Add and verify your own domain before launch. The [email DNS checker](/tools/email-dns-checker) shows whether its SPF, DKIM and DMARC records resolve.
- **Test mode is billed.** `o:testmode=yes` makes Mailgun accept a message without delivering it, and Mailgun's docs say test-mode messages are still charged ([Test mode](https://documentation.mailgun.com/docs/mailgun/user-manual/sending-messages/test-mode), checked Oct 2026). A CI suite that sends through Mailgun on every run counts against your plan.
- **Dedicated IPs.** Foundation gives access to a dedicated IP from 50,000 emails a month, and Scale includes one. Most transactional senders do fine on shared IPs, so don't move up a plan only for this.

## Mailgun vs Resend, Postmark and Amazon SES on price

Here is the same monthly volume on each provider's own pricing page, all checked November 2026: [Mailgun](https://www.mailgun.com/pricing/), [Resend](https://resend.com/pricing), [Postmark](https://postmarkapp.com/pricing) and [Amazon SES](https://aws.amazon.com/ses/pricing/) (à la carte, 32 KB messages, no add-ons):

- **3,000 a month, at most 100 a day:** Mailgun Free and Resend Free are $0. Postmark Basic is $15 (Postmark's free plan stops at 100 a month). SES is $0.31.
- **10,000 a month:** Mailgun Basic and Postmark Basic are $15. Resend Pro is $20. SES is $1.04.
- **50,000 a month:** Mailgun Foundation is $35. Resend Pro is $20. SES is $5.19.
- **100,000 a month:** Mailgun Scale is $90. Resend Pro is $35. SES is $10.38.

Postmark prices higher volumes on its pricing page slider, so check it for your number.

Mailgun's and Resend's free plans share the same 100-a-day cap, and Resend Free also stops at 3,000 a month. Postmark keeps 45 days of message history on every paid plan, against Mailgun's one day on Basic. Resend keeps 30 days. SES is cheapest by far, and it leaves bounce handling, event delivery and logging to your own AWS setup. [Amazon SES pricing](/blog/amazon-ses-pricing) covers its plans, and [Resend pricing](/blog/resend-pricing) has every Resend tier.

[Mailgun alternatives](/blog/mailgun-alternatives) compares retention and fields across more providers and walks through a switch with Mailgun kept as the fallback.

## Send through Mailgun from Node.js

Email SDK's Mailgun adapter calls Mailgun's Messages API with plain `fetch`, so you don't install `mailgun.js`. The same client takes a memory adapter in tests, so test runs never reach Mailgun and never count against your plan:

`email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { mailgun } from "@opencoredev/email-sdk/mailgun";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";

const isTest = process.env.NODE_ENV === "test";

export const memory = memoryAdapter();

export const email = createEmailClient({
  adapters: [
    isTest
      ? memory
      : mailgun({
          apiKey: process.env.MAILGUN_API_KEY!,
          domain: process.env.MAILGUN_DOMAIN!,
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
    from: "Acme <hello@mail.acme.com>",
    to: "ada@example.com",
    subject: "Welcome to Acme",
    text: "Thanks for signing up.",
  });

  expect(memory.raw?.sent).toHaveLength(1);
  expect(memory.raw?.sent[0]?.message.subject).toBe("Welcome to Acme");
});
```

Run it with `NODE_ENV=test bun test`. No request reaches Mailgun, so the run costs nothing. An account in Mailgun's EU region sets `baseUrl: "https://api.eu.mailgun.net"` on the adapter.

## A second provider when Mailgun fails

When Mailgun answers `429`, a 5xx or not at all, the adapter reports delivery `"unknown"`, because Mailgun may already have accepted the message. A definite rejection such as a `400` or `401` is `"not_sent"` and falls back by default. The default `onUnknownDelivery: "stop"` throws on an unknown failure instead of trying the fallback. To let a throttled password reset go out through another provider, opt in and accept that an uncertain failure could send it twice:

`email-with-fallback.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { mailgun } from "@opencoredev/email-sdk/mailgun";
import { resend } from "@opencoredev/email-sdk/resend";

export const email = createEmailClient({
  adapters: [
    mailgun({
      apiKey: process.env.MAILGUN_API_KEY!,
      domain: process.env.MAILGUN_DOMAIN!,
    }),
    resend({ apiKey: process.env.RESEND_API_KEY! }),
  ],
  defaultAdapter: "mailgun",
  fallback: { adapters: ["resend"], onUnknownDelivery: "continue" },
});
```

Resend rejects repeated header names, which Mailgun accepts, so a message that repeats a header fails validation before either provider is called. [Retries and fallback](/docs/concepts/fallbacks-and-retries) explains the trade-off, and the [Mailgun adapter reference](/docs/adapters/mailgun) lists every option.

The code on this page was typechecked against `@opencoredev/email-sdk` 3.0.1, and the test ran with `bun test`. No real email was sent.

## FAQ

**Does Mailgun have a free plan?** Yes. Free sends 100 emails a day with one sending domain, one inbound route, one user and one day of logs.

**How much does Mailgun cost per 1,000 emails?** Basic includes 10,000 emails for $15, then extra emails cost from $1.80 per 1,000. Foundation's overage starts at $1.30 and Scale's at $1.10.

**Which Mailgun plan should I pick?** At the listed starting rates: Basic up to about 21,000 emails a month, Foundation from there to about 92,000, and Scale above that. Pick Foundation sooner if you need more than a day of logs or a second sending domain.

**Does Mailgun charge for test emails?** Yes, test-mode messages are billed. Use a memory adapter or a local SMTP inbox such as [Mailpit](/blog/mailpit-mailhog-nodejs) in tests instead.

## Related

- [Mailgun API guide for Node.js and TypeScript](/blog/mailgun-api-nodejs-typescript): raw requests, US and EU regions, errors, rate limits and webhooks.
- [Mailgun alternatives](/blog/mailgun-alternatives): retention and fields elsewhere, and a switch with Mailgun as the fallback.
- [Amazon SES pricing](/blog/amazon-ses-pricing) and [Resend pricing](/blog/resend-pricing): the same breakdown for those providers.
- [Resend vs Mailgun](/compare/resend-vs-mailgun), [SendGrid vs Mailgun](/compare/sendgrid-vs-mailgun) and [Mailgun vs Amazon SES](/compare/mailgun-vs-ses): field support next to other providers.
- [Mailgun adapter reference](/docs/adapters/mailgun): adapter options and field mapping.
