# SendGrid Pricing in 2026: Plans, Overage and Free Trial

SendGrid has no free plan any more. A new account gets a 60-day trial that sends 100 emails a day. After that, the Email API's Essentials plan costs $19.95 a month for 50,000 emails or $34.95 for 100,000. Pro starts at $89.95 for 100,000 and runs to $1,099 for 2.5 million, and Premier is quote-only. Past the included volume, each extra 1,000 emails costs between $0.47 and $1.33, depending on the plan. Every number on this page comes from [Twilio's SendGrid pricing page](https://www.twilio.com/en-us/products/email-api/pricing) and its [pricing PDF](https://twilio.com/content/dam/twilio-com/global/en/pricing/all-pricing/twi121--sendgrid-pricing-pdf-st1.pdf), checked November 2026. Prices change, so confirm them there before you commit.

This page covers each Email API plan, which plan is cheapest at your volume, what Pro adds besides volume, SendGrid next to Amazon SES, Resend and Postmark, and how to keep tests from using your quota. The code is near the end, under "Send through SendGrid from Node.js". Marketing Campaigns plans are priced separately and aren't covered here.

## SendGrid Email API plans

| Plan | Per month | Extra per 1,000 |
| --- | --- | --- |
| Free trial | $0 for 60 days, 100 a day | none |
| Essentials 50K | $19.95 | $1.33 |
| Essentials 100K | $34.95 | $0.88 |
| Pro 100K | $89.95 | $1.10 |
| Pro 300K | $249 | $0.91 |
| Pro 700K | $499 | $0.78 |
| Pro 1.5M | $799 | $0.59 |
| Pro 2.5M | $1,099 | $0.47 |
| Premier | custom | custom |

The number after each plan name is how many emails a month it includes. Twilio lists overage per extra email ($0.00133 on Essentials 50K, for example), shown here per 1,000.

## What happened to the SendGrid free plan

Twilio [retired the free Email API plan on May 27, 2025](https://www.twilio.com/en-us/changelog/sendgrid-free-plan). Existing free accounts kept sending for a 60-day transition, then needed a paid plan to keep sending email. New accounts now start on the free trial, which sends 100 emails a day for 60 days with no credit card. Plan to move to a paid plan before the trial ends, because a password reset that can't go out is an outage for your users.

If you only need a few thousand emails a month, other providers still have a free tier: [Resend Free](https://resend.com/pricing) sends 3,000 a month (at most 100 a day) and [Mailgun Free](https://www.mailgun.com/pricing/) sends 100 a day, both checked November 2026. [SendGrid alternatives](/blog/sendgrid-alternatives) compares them, with a migration that keeps SendGrid as the fallback.

## Which plan is cheapest at your volume

This table applies the published plan prices and overage rates, with no add-ons:

| Emails per month | Cheapest plan | Cost |
| --- | --- | --- |
| 50,000 | Essentials 50K | $19.95 |
| 75,000 | Essentials 100K | $34.95 |
| 100,000 | Essentials 100K | $34.95 |
| 250,000 | Essentials 100K + extra | $166.95 |
| 500,000 | Essentials 100K + extra | $386.95 |
| 700,000 | Pro 700K | $499 |
| 1,000,000 | Pro 700K + extra | $733 |
| 1,500,000 | Pro 1.5M | $799 |
| 2,500,000 | Pro 2.5M | $1,099 |

Three break-even points decide most choices:

- **Essentials 50K or 100K.** Overage on the 50K plan costs $1.33 per 1,000, so the 100K plan is cheaper from about 61,300 emails a month.
- **Essentials or Pro.** Essentials 100K plus $0.88 per extra 1,000 stays cheaper than any Pro plan up to about 627,300 emails a month, where Pro 700K ($499) takes over. Twilio sells Essentials for 50,000 to 100,000 emails a month and says upgrading usually beats paying overage if you pass your limit every month. On the published rates that only holds from about 627,300, unless you need what Pro adds.
- **Pro 700K or 1.5M.** At $0.78 per extra 1,000, Pro 700K plus overage is cheaper than Pro 1.5M up to about 1,084,600 emails a month.

SendGrid counts every recipient as one email, so a message to three addresses uses three. Taxes are extra.

## What Pro adds besides volume

At 100,000 emails a month, Pro costs $55 more than Essentials. Here is what that buys, from the pricing page's feature table:

- **Dedicated IP.** Pro and Premier include one dedicated IP with automated warm-up, and you can buy more. Essentials sends from shared IP pools.
- **Email activity history.** The trial and Essentials keep 3 days of searchable email activity. Pro keeps 7 days. Longer history is a paid add-on on Essentials, Pro and Premier (Twilio excludes Premier plans at 100 million emails and above), not on the trial.
- **Event Webhooks.** The trial includes 1, Essentials 2, Pro and Premier 5.
- **Teammates and subusers.** The trial and Essentials include 1 teammate. Pro includes 1,000 teammates, subuser management and single sign-on.
- **Email validation.** Pro includes 2,500 address validations and Premier 5,000. Essentials includes none.
- **Support.** Essentials gets ticket and chat support, Pro adds phone support, and Premier gets prioritized support.

Three days of activity is the limit most teams hit first. If a user reports on Monday that a Friday email never arrived, Essentials can't show you the record any more. Store SendGrid's Event Webhook events yourself, and you can stay on Essentials longer.

## SendGrid vs Amazon SES, Resend and Postmark on price

Here is the same monthly volume on each provider's own pricing page, all checked November 2026: [SendGrid](https://www.twilio.com/en-us/products/email-api/pricing), [Amazon SES](https://aws.amazon.com/ses/pricing/) (à la carte at $0.10 per 1,000 plus $0.12 per GB of message data, 32 KB messages), [Resend](https://resend.com/pricing) and [Postmark](https://postmarkapp.com/pricing):

- **3,000 a month, at most 100 a day:** SendGrid is $0 only during the 60-day trial. Resend Free is $0. SES is $0.31. Postmark Basic is $15 (its free plan stops at 100 a month).
- **50,000 a month:** SendGrid Essentials is $19.95. Resend Pro is $20. SES is $5.19.
- **100,000 a month:** SendGrid Essentials is $34.95. Resend Pro is $35. SES is $10.38.
- **1,000,000 a month:** SendGrid Pro 700K plus overage is $733. Resend Scale is $650. SES is $103.84.

Postmark prices volumes above 10,000 on its pricing page slider, so check it for your number.

For a small SaaS, the choice between SendGrid and SES comes down to how much of the email stack you want to run. SES costs a fraction of SendGrid at every volume, but you build bounce handling, event storage and a dashboard on your own AWS setup, and new accounts start in the SES sandbox. SendGrid gives you those parts in its console, with 3 days of activity on Essentials. [Amazon SES pricing](/blog/amazon-ses-pricing) covers SES's plans, and [SendGrid vs Amazon SES](/compare/sendgrid-vs-ses) compares the message fields each one accepts.

## Send through SendGrid from Node.js

Email SDK's SendGrid adapter calls SendGrid's v3 Mail Send API with plain `fetch`, so you don't install `@sendgrid/mail`. The same client takes a memory adapter in tests, so test runs never reach SendGrid and never use the trial's 100 emails a day:

`email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { sendgrid } from "@opencoredev/email-sdk/sendgrid";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";

const isTest = process.env.NODE_ENV === "test";

export const memory = memoryAdapter();

export const email = createEmailClient({
  adapters: [isTest ? memory : sendgrid({ apiKey: process.env.SENDGRID_API_KEY! })],
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

Run it with `NODE_ENV=test bun test`. No request reaches SendGrid, so the run costs nothing. SendGrid's own sandbox mode also accepts a message without delivering it, but the adapter doesn't set it. The [SendGrid API guide](/blog/sendgrid-api-nodejs-typescript) shows the raw request for it.

## Amazon SES as the fallback

SES is the cheapest backup for a SendGrid account: at $0.10 per 1,000, it costs almost nothing while it waits. When SendGrid answers `429`, a 5xx or not at all, the adapter reports delivery `"unknown"`, because SendGrid may already have accepted the message. A definite rejection such as a `401` or `422` is `"not_sent"` and falls back by default. The default `onUnknownDelivery: "stop"` throws on an unknown failure instead of trying the fallback. To let a throttled password reset go out through SES, opt in and accept that an uncertain failure could send it twice:

`email-with-fallback.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { sendgrid } from "@opencoredev/email-sdk/sendgrid";
import { ses } from "@opencoredev/email-sdk/ses";

export const email = createEmailClient({
  adapters: [
    sendgrid({ apiKey: process.env.SENDGRID_API_KEY! }),
    ses({
      accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      region: process.env.AWS_REGION!,
    }),
  ],
  defaultAdapter: "sendgrid",
  fallback: { adapters: ["ses"], onUnknownDelivery: "continue" },
});
```

SES takes neither `metadata` (SendGrid's `custom_args`) nor `sendAt`, both of which SendGrid accepts. The client checks every adapter on the route before sending, so a message that uses either fails validation before SendGrid is called. Verify the `from` domain in SES before you rely on the fallback, and move the account out of the SES sandbox: sandbox sending is limited to verified addresses and domains, plus the SES mailbox simulator ([SES sandbox](https://docs.aws.amazon.com/ses/latest/dg/request-production-access.html), checked November 2026). [Retries and fallback](/docs/concepts/fallbacks-and-retries) explains the trade-off, and the [SendGrid adapter reference](/docs/adapters/sendgrid) lists every option.

The code on this page was typechecked against `@opencoredev/email-sdk` 3.0.1, and the test ran with `bun test`. No real email was sent.

## FAQ

**Is SendGrid free?** Not any more. Twilio retired the free plan in May 2025. New accounts get a 60-day trial at 100 emails a day, then need a paid plan, which starts at $19.95 a month.

**How much does SendGrid cost per 1,000 emails?** Essentials 50K works out to $0.40 per 1,000 if you use all 50,000, and Essentials 100K to $0.35. Extra emails past a plan's volume cost from $1.33 per 1,000 on Essentials 50K down to $0.47 on Pro 2.5M.

**What is the difference between SendGrid Essentials and Pro?** Pro includes a dedicated IP, 7 days of email activity instead of 3, 5 Event Webhooks, 1,000 teammates, subusers, single sign-on, 2,500 email validations and phone support. Essentials is cheaper at every volume up to about 627,300 emails a month.

**Is SendGrid cheaper than Amazon SES?** No. SES à la carte costs $10.38 for 100,000 emails against $34.95 on SendGrid Essentials, but you run the logging, bounce handling and dashboards yourself.

## Related

- [SendGrid API guide for Node.js and TypeScript](/blog/sendgrid-api-nodejs-typescript): API keys, Mail Send with `fetch`, scheduling, sandbox mode and signed webhooks.
- [SendGrid alternatives](/blog/sendgrid-alternatives): prices and fields elsewhere, and a switch with SendGrid kept as the fallback.
- [Amazon SES pricing](/blog/amazon-ses-pricing), [Resend pricing](/blog/resend-pricing) and [Mailgun pricing](/blog/mailgun-pricing): the same breakdown for those providers.
- [SendGrid vs Amazon SES](/compare/sendgrid-vs-ses), [Resend vs SendGrid](/compare/resend-vs-sendgrid) and [SendGrid vs Mailgun](/compare/sendgrid-vs-mailgun): field support next to other providers.
- [SendGrid adapter reference](/docs/adapters/sendgrid): adapter options and field mapping.
