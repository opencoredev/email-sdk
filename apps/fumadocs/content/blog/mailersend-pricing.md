# MailerSend Pricing in 2026: Plans, Overage and Free Plan

MailerSend has four self-serve plans. Free costs $0 and sends 500 emails a month, at most 100 a day. Hobby is $7 a month for 5,000 emails, Starter starts at $35 for 50,000, and Professional starts at $110 for 50,000. Past the included volume, each extra 1,000 emails costs $1.50 on Hobby and from $1.30 on Starter and Professional, falling to $1.00 and $0.50 on the largest plan sizes. Paying yearly takes 10% off. Enterprise is quote-only. Every number on this page comes from [mailersend.com/pricing](https://www.mailersend.com/pricing) and MailerSend's [plans, features and limits](https://www.mailersend.com/help/plans-features-and-limits) page, checked November 2026. Prices change, so confirm them there before you commit.

This page covers what each plan includes, which plan is cheapest at your volume, the limits that matter more than price for an app (activity retention and custom headers most of all), what MailerSend costs next to Resend, SendGrid, Mailgun and Amazon SES, and how to keep tests from using your quota. The code is near the end, under "Send through MailerSend from Node.js".

## MailerSend plans

| Plan | Per month | Extra per 1,000 |
| --- | --- | --- |
| Free | $0 for 500 | none |
| Hobby | $7 for 5,000 | $1.50 |
| Starter | from $35 for 50,000 | from $1.30 |
| Professional | from $110 for 50,000 | from $1.30 |

Prices are monthly billing. Starter and Professional come in plan sizes, and a bigger size costs less per email:

| Emails per month | Starter | Professional |
| --- | --- | --- |
| 50,000 | $35 | $110 |
| 100,000 | $68 | $140 |
| 250,000 | $162.50 | $275 |
| 500,000 | $325 | $525 |
| 1,000,000 | $600 | $1,000 |

Starter stops at 1 million a month. Professional continues at $1,350 for 1.5 million and $1,600 for 2 million. The overage rate also drops with size: Starter charges $1.30 per extra 1,000 at 50,000 and 100,000, $1.10 at 250,000 and 500,000, and $1.00 at 1 million. Professional charges $1.30, $1.30, $1.00, $0.80 and $0.60 for the same sizes, and $0.50 at 2 million. MailerSend bills overage on your next invoice, and the email count resets every 30 days. You can set a billing limit if you'd rather stop sending than pay overage.

What changes between the plans, beyond volume:

- **Free:** 500 emails a month and 100 a day, 1 sending domain, 1 API token, 1 webhook, 1 inbound route, 1 template, 100 API requests a day and 24 hours of activity data. Sending pauses at the limit, because Free allows no overage.
- **Hobby:** 1 sending domain, 3 API tokens, 5 webhooks, 1 inbound route, 10 templates, 5 users, 1,000 API requests a day and 24 hours of activity data. Adds user roles and the bulk email endpoint.
- **Starter:** 10 sending domains, 50 API tokens, webhooks and inbound routes, 250 templates, 5 users, 100,000 API requests a day and 7 days of activity data. Adds the SMS API (US and Canada), sender identities, live chat support and per-domain reputation.
- **Professional:** 1,000 sending domains, 5,000 webhooks, 5,000 templates, 1,000 users, 500,000 API requests a day, 30 days of activity data and 7 days of API logs. Adds custom headers, DMARC monitoring for 10 domains and priority support.

Dedicated IPs are for Enterprise accounts that send more than 100,000 emails a week. Activity retention can be extended up to 365 days as an add-on, priced from $5.

## Which plan is cheapest at your volume

This table applies the monthly prices and overage rates above, with no add-ons or yearly discount:

| Emails per month | Cheapest plan | Per month |
| --- | --- | --- |
| 500 | Free | $0 |
| 5,000 | Hobby | $7 |
| 10,000 | Hobby | $14.50 |
| 25,000 | Starter 50K | $35 |
| 100,000 | Starter 100K | $68 |
| 250,000 | Starter 250K | $162.50 |
| 500,000 | Starter 500K | $325 |
| 1,000,000 | Starter 1M | $600 |

Free covers you up to 500 emails a month and 100 a day. Starter 50K becomes cheaper than Hobby at about 23,700 emails a month: $7 plus 18.7 thousand extra emails at $1.50 comes to $35. Above that, Starter 50K is cheaper and brings 7 days of activity data. Each Starter size then beats the size below it plus overage: 100K wins above about 75,400 emails (50K plus $1.30 per extra 1,000 passes $68), 250K above about 172,700, 500K above about 397,700 (at $1.10 overage) and 1M above 750,000. Below 2 million emails a month, Professional always costs more than Starter. You pay for its 30-day activity data, request logs, custom headers and higher limits.

## The limits that matter more than price

For an app that sends receipts, resets and invites, a few plan limits affect your users more than the monthly bill:

- **Activity retention.** Free and Hobby keep 24 hours of activity data. If a user writes in on Monday about a Friday email that never arrived, the record is gone. Starter keeps 7 days and Professional 30. On a smaller plan, store MailerSend's webhook events yourself.
- **Custom headers need Professional.** MailerSend accepts custom email headers only on Professional and Enterprise. Code that sets a `List-Unsubscribe` or tracking header works during the Professional trial and stops working after you move to Starter or Hobby.
- **The daily API cap.** Free allows 100 API requests a day and Hobby 1,000. A signup spike or a backfill script can hit that before the monthly email quota. Starter raises it to 100,000.
- **Approval and Sandbox mode.** A new account that skips the trial lands in Sandbox mode: 100 emails a month, sent to at most 2 recipients until MailerSend approves the account. Approval lifts the recipient limit but keeps the 100 a month ([Sandbox mode and the Professional trial](https://www.mailersend.com/help/sandbox-mode-and-the-professional-trial), checked Nov 2026). To get the Free plan's 500 a month, subscribe to Free on the Plan and billing page with your organization's address and a credit card. Verify your sending domain early. The [email DNS checker](/tools/email-dns-checker) shows whether its SPF, DKIM and DMARC records resolve.
- **The 14-day trial isn't Professional at full size.** It has Professional's features, but only 500 emails a month, 100 API requests a day and no overage. When it ends without a subscription, the account moves to Free and any domains over the limit are paused.

## MailerSend vs Resend, SendGrid, Mailgun and Amazon SES on price

Here is the same monthly volume on each provider's own pricing page, all checked November 2026: [MailerSend](https://www.mailersend.com/pricing), [Resend](https://resend.com/pricing), [SendGrid](https://www.twilio.com/en-us/products/email-api/pricing), [Mailgun](https://www.mailgun.com/pricing/) and [Amazon SES](https://aws.amazon.com/ses/pricing/) (à la carte, 32 KB messages, no add-ons):

- **10,000 a month:** MailerSend Hobby with overage is $14.50. Mailgun Basic is $15, SendGrid Essentials $19.95 and Resend Pro $20. SES is $1.04.
- **50,000 a month:** MailerSend Starter is $35, the same as Mailgun Foundation. SendGrid is $19.95 and Resend $20. SES is $5.19.
- **100,000 a month:** MailerSend Starter is $68 and Mailgun $75. SendGrid is $34.95 and Resend $35. SES is $10.38.
- **500,000 a month:** MailerSend Starter is $325, Resend $350, SendGrid $386.95 and Mailgun $400. SES is $51.92.
- **1,000,000 a month:** MailerSend Starter is $600, Resend $650, Mailgun $700 and SendGrid $733. SES is $103.84.

Among MailerSend, Resend, SendGrid and Mailgun, MailerSend is cheapest at 10,000, 500,000 and 1 million, and costs 75% to 95% more than SendGrid and Resend at 50,000 and 100,000. Its free plan is the smallest: 500 a month, where Resend Free sends 3,000 and Mailgun Free 100 a day. SES is cheapest at every volume and leaves bounce handling, event delivery and logging to your own AWS setup. [Email API pricing compared](/blog/email-api-pricing) puts SES, Resend, SendGrid, Mailgun and Postmark side by side, and [Resend vs MailerSend](/compare/resend-vs-mailersend) compares the fields each API accepts.

## Send through MailerSend from Node.js

Email SDK's MailerSend adapter calls MailerSend's Email API with plain `fetch`, so you don't install `mailersend`. The same client takes a memory adapter in tests, so test runs never reach MailerSend and never use your monthly or daily quota:

`email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { mailersend } from "@opencoredev/email-sdk/mailersend";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";

const isTest = process.env.NODE_ENV === "test";

export const memory = memoryAdapter();

export const email = createEmailClient({
  adapters: [
    isTest ? memory : mailersend({ apiKey: process.env.MAILERSEND_API_KEY! }),
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

Run it with `NODE_ENV=test bun test`. No request reaches MailerSend, so the run costs nothing and leaves the 100 or 1,000 daily API requests of Free and Hobby for real traffic.

## A second provider when MailerSend fails

When MailerSend answers `429`, a 5xx or not at all, the adapter reports delivery `"unknown"`, because MailerSend may already have accepted the message. A definite rejection such as a `401` or `422` is `"not_sent"` and falls back by default. The default `onUnknownDelivery: "stop"` throws on an unknown failure instead of trying the fallback. To let a password reset go out through another provider when MailerSend throttles you, for example after Free or Hobby hits its daily API cap, opt in and accept that an uncertain failure could send it twice:

`email-with-fallback.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { mailersend } from "@opencoredev/email-sdk/mailersend";
import { resend } from "@opencoredev/email-sdk/resend";

export const email = createEmailClient({
  adapters: [
    mailersend({ apiKey: process.env.MAILERSEND_API_KEY! }),
    resend({ apiKey: process.env.RESEND_API_KEY! }),
  ],
  defaultAdapter: "mailersend",
  fallback: { adapters: ["resend"], onUnknownDelivery: "continue" },
});
```

MailerSend accepts only one reply-to address and has no `metadata` field, so a message containing `metadata` or more than one reply-to address fails validation before any provider is called; use `tags` instead of metadata. Verify your sending domain with Resend as well before you rely on the fallback, because Resend rejects mail from a domain it hasn't verified. [Retries and fallback](/docs/concepts/fallbacks-and-retries) explains the trade-off, and the [MailerSend adapter reference](/docs/adapters/mailersend) lists every option.

The code on this page was typechecked against `@opencoredev/email-sdk` 3.1.0, and the test ran with `bun test`. No real email was sent.

## FAQ

**Does MailerSend have a free plan?** Yes. Free sends 500 emails a month, at most 100 a day, with 1 sending domain, 1 API token, 100 API requests a day and 24 hours of activity data. You subscribe to it from the Plan and billing page with an address and a credit card. Without that, an account stays in Sandbox mode: 100 emails a month, to at most 2 recipients until MailerSend approves it.

**How much does MailerSend cost per 1,000 emails?** Hobby includes 5,000 emails for $7, then extra emails cost $1.50 per 1,000. Starter's overage starts at $1.30 and falls to $1.00 on the 1 million plan. Professional's falls from $1.30 to $0.50.

**Which MailerSend plan should I pick?** Free if you stay under 500 emails a month and 100 a day, Hobby up to about 23,700 a month, then Starter. Move to a bigger Starter size only past the break-even points above (about 75,400 emails for 100K), because a smaller size plus overage is cheaper until then. Pick Starter sooner if you need more than 24 hours of activity data or a second sending domain, and Professional if you need custom headers, 30 days of activity data or request logs.

**Is MailerSend cheaper than Resend?** At 10,000, 500,000 and 1 million emails a month, yes. At 50,000 and 100,000, Resend Pro ($20 and $35) costs less than MailerSend Starter ($35 and $68).

## Related

- [Email API pricing compared](/blog/email-api-pricing): SES, Resend, SendGrid, Mailgun and Postmark at the same monthly volumes, and their free tiers.
- [Resend pricing](/blog/resend-pricing), [SendGrid pricing](/blog/sendgrid-pricing), [Mailgun pricing](/blog/mailgun-pricing) and [Amazon SES pricing](/blog/amazon-ses-pricing): the same breakdown for those providers.
- [Resend vs MailerSend](/compare/resend-vs-mailersend), [Brevo vs MailerSend](/compare/brevo-vs-mailersend) and [MailerSend vs Amazon SES](/compare/mailersend-vs-ses): field support next to other providers.
- [MailerSend adapter reference](/docs/adapters/mailersend): adapter options and field mapping.
