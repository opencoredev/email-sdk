# SendGrid API Guide for Node.js and TypeScript

This guide calls the Twilio SendGrid v3 API from Node.js and TypeScript with plain `fetch`. It covers API keys, the Mail Send endpoint, dynamic templates, attachments, scheduling and cancelling sends, sandbox mode, errors, rate limits, and signed Event Webhooks. The last section sends the same email through Email SDK's `sendgrid` adapter with Postmark as a fallback.

Every SendGrid detail on this page was checked against [Twilio's SendGrid documentation](https://www.twilio.com/docs/sendgrid) in November 2026. Already using Email SDK? The [SendGrid adapter reference](/docs/adapters/sendgrid) lists every option, and [Postmark vs SendGrid](/compare/postmark-vs-sendgrid) puts SendGrid's message fields next to another provider.

## What you need

- A SendGrid account with a verified sender identity or an authenticated domain. The [email DNS checker](/tools/email-dns-checker) shows whether SPF, DKIM, and DMARC resolve for your domain.
- An API key, covered in the next section. SendGrid has no free plan any more: new accounts get a 60-day trial at 100 emails a day, and Essentials starts at $19.95 a month ([SendGrid pricing](https://www.twilio.com/en-us/products/email-api/pricing), checked Nov 2026).
- A server runtime with `fetch` built in, such as Node.js 20+ or Bun. Keep the key on the server. A key with Mail Send access can send mail as your domain.

## Create a SendGrid API key

Open **Settings > API Keys** in the SendGrid console and click **Create API Key**. SendGrid shows the key once, so copy it into your secret store right away ([API keys](https://www.twilio.com/docs/sendgrid/ui/account-and-settings/api-keys), checked Nov 2026).

Three things about the key itself:

- **It starts with `SG.`** The official Node.js client warns when a key doesn't, so a `SENDGRID_API_KEY` without that prefix is usually a copy-paste mistake or the key ID instead of the key.
- **Pick the narrowest access.** Full Access reaches every endpoint. For a server that only sends, choose Custom Access and grant Mail Send. Billing endpoints need a separate key.
- **You can't read it back.** SendGrid can't show or restore a key later. To rotate, create a new key, deploy it, then delete the old one. An account can hold up to 100 keys.

Keep the key in an environment variable such as `SENDGRID_API_KEY` and out of your repository. If a key leaks, delete it in the console; requests with a deleted key are rejected.

Every request sends the key as a bearer token. `GET /v3/scopes` returns the scopes the key has, which makes it a cheap check that the key works and can send ([scopes](https://www.twilio.com/docs/sendgrid/api-reference/api-key-permissions/retrieve-a-list-of-scopes-for-which-this-user-has-access), checked Nov 2026):

```bash
curl https://api.sendgrid.com/v3/scopes -H "Authorization: Bearer $SENDGRID_API_KEY"
# {"scopes":["mail.send", ...]}
```

Look for `mail.send` in the list. EU regional subusers use `https://api.eu.sendgrid.com` instead of `https://api.sendgrid.com` for this and every other call.

## Send an email with fetch

The endpoint is `POST /v3/mail/send` ([Mail Send](https://www.twilio.com/docs/sendgrid/api-reference/mail-send/mail-send), checked Nov 2026). The body needs `personalizations` (each with a `to` list) and `from`, plus a `subject` and `content` unless a template supplies them. Addresses are objects with an `email` and an optional `name`.

This script sends an order confirmation with a Reply-To address, a category, a custom argument, and a PDF attachment:

`send-fetch.ts`:

```ts
import { readFile } from "node:fs/promises";

const apiKey = process.env.SENDGRID_API_KEY;

if (!apiKey) throw new Error("Set SENDGRID_API_KEY.");

const pdf = await readFile(new URL("./invoice.pdf", import.meta.url));

const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    personalizations: [
      {
        to: [{ email: "ada@example.com", name: "Ada Lovelace" }],
        custom_args: { order_id: "ord_123" },
      },
    ],
    from: { email: "orders@acme.com", name: "Acme" },
    reply_to: { email: "support@acme.com" },
    subject: "Your Acme order is confirmed",
    content: [
      { type: "text/plain", value: "Thanks for your order. Your invoice is attached." },
      { type: "text/html", value: "<p>Thanks for your order. Your invoice is attached.</p>" },
    ],
    categories: ["order-confirmation"],
    attachments: [
      {
        content: pdf.toString("base64"),
        filename: "invoice.pdf",
        type: "application/pdf",
        disposition: "attachment",
      },
    ],
  }),
});

if (response.status !== 202) {
  throw new Error(`SendGrid ${response.status}: ${await response.text()}`);
}

console.log(response.headers.get("x-message-id"));
```

SendGrid answers `202 Accepted` with an empty body. The only ID you get back is the `X-Message-Id` response header. Store it: the `sg_message_id` in webhook events starts with that value, followed by a dot and a filter suffix, so match on the part before the first dot.

`content` must list `text/plain` before `text/html` when you send both. The fields you'll use most:

| Field | Type | Notes |
| --- | --- | --- |
| `personalizations` | array, up to 1,000 | Each entry is one envelope: its own `to`, `cc`, `bcc`, `subject`, `headers`, `custom_args`, `send_at`, and template data. |
| `from` | `{ email, name? }` | Must match a verified sender or an authenticated domain, or the request fails with `403`. |
| `reply_to` or `reply_to_list` | object, or array up to 1,000 | Use one, not both. |
| `content` | array of `{ type, value }` | Plain text first, then HTML. |
| `template_id` | string | IDs starting with `d-` are dynamic templates. |
| `categories` | array of strings | Up to 10, each up to 255 characters. They come back on every event. |
| `custom_args` | object | Your own key-value pairs, at most 10,000 bytes in total. They come back on every event. |
| `headers` | object | Custom headers only. Standard ones are reserved (below). |
| `attachments` | array | Each with Base64 `content`, `filename`, and optional `type`, `disposition`, `content_id`. |
| `send_at` | Unix timestamp in seconds | Up to 72 hours ahead. |
| `batch_id` | string | Lets you pause or cancel a scheduled send. |

The reserved header names are `To`, `From`, `Subject`, `Reply-To`, `CC`, `BCC`, `Content-Type`, `Content-Transfer-Encoding`, `DKIM-Signature`, `Received`, `x-sg-id`, and `x-sg-eid`. SendGrid builds those from the body fields or sets them itself.

Personalizations are where SendGrid differs most from other APIs. Two entries in `personalizations` send two separate emails, so a recipient never sees the other's address. Put everyone in one entry's `to` list and they all see each other.

## Dynamic templates

Build the template in the SendGrid console, then send its `d-` ID with per-recipient `dynamic_template_data`. The template reads the values with Handlebars, such as `{{firstName}}`:

```json
{
  "from": { "email": "orders@acme.com" },
  "template_id": "d-2c214ac919e84170b21855cc129b4a5f",
  "personalizations": [
    { "to": [{ "email": "ada@example.com" }], "dynamic_template_data": { "firstName": "Ada", "orderId": "ord_123" } }
  ]
}
```

A template that sets its own subject or content overrides the values in the request. Don't send `substitutions` with a dynamic template; those belong to legacy templates.

## Schedule, pause, and cancel a send

`send_at` takes a Unix timestamp in seconds and accepts at most 72 hours ahead. To keep the option of cancelling, create a batch ID first and send it with the email ([Cancel a scheduled send](https://www.twilio.com/docs/sendgrid/for-developers/sending-email/stopping-a-scheduled-send), checked Nov 2026):

`schedule.ts`:

```ts
const apiKey = process.env.SENDGRID_API_KEY;

if (!apiKey) throw new Error("Set SENDGRID_API_KEY.");

const headers = { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" };

async function sendGrid(path: string, expected: number, body?: unknown) {
  const response = await fetch(`https://api.sendgrid.com${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (response.status !== expected) throw new Error(`SendGrid ${path} ${response.status}: ${await response.text()}`);

  return response;
}

// Create a batch ID (201 Created), then schedule the email with it (202 Accepted).
// Save the returned batch ID with your job so a later request can cancel the send.
export async function scheduleTrialReminder(to: string, sendAt: Date) {
  const batch: unknown = await (await sendGrid("/v3/mail/batch", 201)).json();
  const batchId = typeof batch === "object" && batch !== null ? Reflect.get(batch, "batch_id") : undefined;

  if (typeof batchId !== "string" || batchId === "") throw new Error("SendGrid returned no batch_id.");

  await sendGrid("/v3/mail/send", 202, {
    personalizations: [{ to: [{ email: to }] }],
    from: { email: "orders@acme.com" },
    subject: "Your trial ends tomorrow",
    content: [{ type: "text/plain", value: "Your Acme trial ends tomorrow." }],
    send_at: Math.floor(sendAt.getTime() / 1000),
    batch_id: batchId,
  });

  return batchId;
}

// Call later, more than 10 minutes before the send time. Use "pause" to hold it instead. 201 Created.
export async function cancelScheduledSend(batchId: string) {
  await sendGrid("/v3/user/scheduled_sends", 201, { batch_id: batchId, status: "cancel" });
}
```

Store the batch ID next to the job that scheduled it. The cancel or pause has to arrive at least 10 minutes before the send time, and at most 10 batches can be paused or cancelled at once. A paused batch that is still paused 72 hours after its `send_at` is discarded and marked Expired. Anything further out than 72 hours belongs in your own job queue.

## Test without emailing anyone

Set `mail_settings.sandbox_mode.enable` to `true` ([Sandbox mode](https://www.twilio.com/docs/sendgrid/for-developers/sending-email/sandbox-mode), checked Nov 2026):

```json
{ "mail_settings": { "sandbox_mode": { "enable": true } } }
```

SendGrid validates the request and answers `200 OK` instead of `202`, sends nothing, uses no credits, and creates no Event Webhook or Email Activity entries. `enable` must be a boolean; the string `"true"` is an error. A sandbox pass proves the key and the payload shape. It doesn't prove the sender is verified or that mail arrives, so do one real send to an inbox you own before launch.

## Errors and rate limits

Error bodies carry an `errors` array, where each entry has a `message` and, when it applies, the `field` that caused it:

```json
{ "errors": [{ "message": "The from address does not match a verified Sender Identity.", "field": "from" }] }
```

| Status | Usually means | What to do |
| --- | --- | --- |
| `400` | A missing or invalid field | Read `errors[].field` and fix the request. Retrying sends the same error. |
| `401` | Missing or wrong API key | Check the key and the host (global vs EU). |
| `403` | The key lacks Mail Send access, or `from` isn't a verified sender | Fix the key's access or verify the sender. |
| `413` | The message is too large | Shrink or link attachments. |
| `429` | Rate limited | Wait until `X-RateLimit-Reset`. |
| `5xx` | SendGrid failed | Retrying may send a second copy (see below). |

Responses carry `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset`, where the reset is a Unix timestamp ([rate limits](https://www.twilio.com/docs/sendgrid/api-reference/how-to-use-the-sendgrid-v3-api/rate-limits), checked Nov 2026). Each endpoint has its own limit, and a `429` blocks that endpoint until the reset.

### Retries without an idempotency key

SendGrid's Mail Send API has no idempotency key. If a request times out or returns a `5xx`, SendGrid may already have accepted the email, and a retry can deliver it twice. A `429` is different: SendGrid refused the request, so retrying it is safe.

This helper always retries `429`, waiting until the reset time, because a request sent earlier is blocked again. If the reset is more than 2 minutes away, it throws instead, so a queue can reschedule the job. It retries `5xx` and network errors only when you pass `retryUnknown: true`, which accepts a possible duplicate in exchange for not losing the email. Each attempt times out after 10 seconds, and backoff waits are capped at 30 seconds:

`send-with-retry.ts`:

```ts
type SendGridMail = Record<string, unknown>;

type RetryOptions = { maxAttempts?: number; retryUnknown?: boolean };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const backoff = (attempt: number) => Math.min(2 ** attempt * 500, 30_000);

const maxRateLimitWaitMs = 120_000;

function untilReset(response: Response, attempt: number) {
  const reset = Number(response.headers.get("x-ratelimit-reset"));
  const waitMs = reset * 1000 - Date.now();

  return Number.isFinite(waitMs) && waitMs > 0 ? waitMs : backoff(attempt);
}

export async function sendWithRetry(mail: SendGridMail, apiKey: string, options: RetryOptions = {}) {
  const { maxAttempts = 3, retryUnknown = false } = options;
  const body = JSON.stringify(mail);

  for (let attempt = 1; ; attempt++) {
    let response: Response;

    try {
      response = await fetch("https://api.sendgrid.com/v3/mail/send", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      // The request may have reached SendGrid before it failed.
      if (!retryUnknown || attempt >= maxAttempts) throw error;
      await sleep(backoff(attempt));
      continue;
    }

    if (response.status === 202 || response.status === 200) {
      return { messageId: response.headers.get("x-message-id") ?? undefined };
    }

    const retryable = response.status === 429 || (retryUnknown && response.status >= 500);

    if (!retryable || attempt >= maxAttempts) {
      throw new Error(`SendGrid ${response.status}: ${await response.text()}`);
    }

    // Release the connection before waiting; the body of a 429 or 5xx isn't needed.
    await response.body?.cancel();

    if (response.status !== 429) {
      await sleep(backoff(attempt));
      continue;
    }

    const waitMs = untilReset(response, attempt);

    if (waitMs > maxRateLimitWaitMs) {
      throw new Error(`SendGrid rate limit resets in ${Math.ceil(waitMs / 1000)} s; retry the job later.`);
    }

    await sleep(waitMs);
  }
}
```

If duplicates matter, put your own ID in `custom_args` (for example `order_id`) and dedupe on it where the email's effects land, such as your webhook handler or support tooling.

## Verify Event Webhook signatures

The Event Webhook posts a JSON array of events to your URL: `processed`, `delivered`, `deferred`, `bounce`, `dropped`, plus engagement events such as `open`, `click`, `spamreport`, and `unsubscribe` ([Event Webhook reference](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/event), checked Nov 2026). Each event carries `email`, `event`, `timestamp`, `sg_event_id`, `sg_message_id`, `category`, and your `custom_args` as top-level fields. If your endpoint doesn't answer with a `2xx`, SendGrid retries at increasing intervals for up to 24 hours, so the same event can arrive more than once. Dedupe on `sg_event_id`.

Turn on **Signed Event Webhook** in the webhook settings. SendGrid then signs each request with ECDSA and SHA-256 and sends two headers, `X-Twilio-Email-Event-Webhook-Signature` and `X-Twilio-Email-Event-Webhook-Timestamp` ([webhook security](https://www.twilio.com/docs/sendgrid/for-developers/tracking-events/getting-started-event-webhook-security-features), checked Nov 2026). The signed bytes are the timestamp followed by the raw request body, so read the body as bytes before you parse it. Node's built-in `crypto` can check the signature with the public key from the webhook settings page:

`webhook.ts`:

```ts
import { createPublicKey, verify } from "node:crypto";

type SendGridEvent = {
  email: string;
  event: string;
  // On bounce events: "bounce" (permanent) or "blocked" (temporary, may be accepted later).
  type?: string;
  timestamp: number;
  sg_event_id: string;
  sg_message_id?: string;
};

const publicKeyBase64 = process.env.SENDGRID_WEBHOOK_PUBLIC_KEY;

if (!publicKeyBase64) throw new Error("Set SENDGRID_WEBHOOK_PUBLIC_KEY.");

// SendGrid shows the verification key as Base64 DER (SubjectPublicKeyInfo).
const publicKey = createPublicKey({ key: Buffer.from(publicKeyBase64, "base64"), format: "der", type: "spki" });

export async function handleSendGridWebhook(request: Request) {
  const signature = request.headers.get("x-twilio-email-event-webhook-signature");
  const timestamp = request.headers.get("x-twilio-email-event-webhook-timestamp");
  const rawBody = Buffer.from(await request.arrayBuffer());

  if (!signature || !timestamp) return new Response("Missing signature", { status: 401 });

  const signed = Buffer.concat([Buffer.from(timestamp), rawBody]);

  if (!verify("sha256", signed, publicKey, Buffer.from(signature, "base64"))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const events: SendGridEvent[] = JSON.parse(rawBody.toString("utf8"));

  for (const event of events) {
    const messageId = event.sg_message_id?.split(".")[0];

    if (event.event === "bounce" && event.type === "blocked") {
      console.log("temporary block, keep the recipient", event.email, messageId, event.sg_event_id);
    } else if (event.event === "bounce" || event.event === "spamreport") {
      console.log("suppress recipient", event.email, messageId, event.sg_event_id);
    }
  }

  return new Response("ok");
}
```

Twilio's official helper for the same check is [`@sendgrid/eventwebhook`](https://www.npmjs.com/package/@sendgrid/eventwebhook). Because SendGrid retries for up to a day, don't reject events by the age of the timestamp header; rely on the signature and on `sg_event_id` for duplicates. SendGrid can also send an OAuth 2.0 bearer token with each request, on top of or instead of the signature.

## The same email with Email SDK

Email SDK wraps the send path above in a typed client. The `sendgrid` adapter builds the same Mail Send request with the bearer key, and lets you list a second provider for when SendGrid fails.

```bash
npm install @opencoredev/email-sdk
```

Create the client once. This one sends through SendGrid and falls back to Postmark:

`email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { sendgrid } from "@opencoredev/email-sdk/sendgrid";

export const email = createEmailClient({
  adapters: [
    sendgrid({ apiKey: process.env.SENDGRID_API_KEY! }),
    postmark({ serverToken: process.env.POSTMARK_SERVER_TOKEN! }),
  ],
  defaultAdapter: "sendgrid",
  retry: { maxAttempts: 3 },
  fallback: { adapters: ["postmark"], onUnknownDelivery: "continue" },
});
```

Then send the order email from the first example. Email SDK takes addresses as strings or `{ email, name }` objects:

`send-sdk.ts`:

```ts
import { readFile } from "node:fs/promises";

import { email } from "./email";

const result = await email.send({
  from: "Acme <orders@acme.com>",
  to: { email: "ada@example.com", name: "Ada Lovelace" },
  replyTo: "support@acme.com",
  subject: "Your Acme order is confirmed",
  html: "<p>Thanks for your order. Your invoice is attached.</p>",
  text: "Thanks for your order. Your invoice is attached.",
  tags: [{ name: "type", value: "order-confirmation" }],
  metadata: { orderId: "ord_123" },
  attachments: [
    {
      filename: "invoice.pdf",
      content: await readFile(new URL("./invoice.pdf", import.meta.url)),
      contentType: "application/pdf",
    },
  ],
});

console.log(result.adapter, result.id);
```

The adapter posts to `https://api.sendgrid.com/v3/mail/send` ([`sendgrid.ts`](https://github.com/opencoredev/email-sdk/blob/main/packages/email-sdk/src/sendgrid.ts)). Set `baseUrl: "https://api.eu.sendgrid.com"` for an EU subuser.

| Email SDK field | SendGrid field |
| --- | --- |
| `from` | `from` as `{ email, name }` |
| `to`, `cc`, `bcc` | one `personalizations` entry with `to`, `cc`, `bcc` |
| `replyTo` | `reply_to_list`, so several addresses work |
| `text`, `html` | `content`, plain text first |
| `headers` | the personalization's `headers` |
| `tags` | `categories`, values only (the tag `name` is dropped) |
| `metadata` | the personalization's `custom_args` |
| `sendAt` | `send_at` in Unix seconds |
| `attachments` | `attachments`, with Base64 `content` |

`result.id` is the ID from the provider named in `result.adapter`: SendGrid's `X-Message-Id` when SendGrid sends, or Postmark's `MessageID` when the fallback does. Store both fields so you match webhooks with the right provider.

The adapter doesn't send `template_id`, `batch_id`, or `mail_settings`, so it renders your own `html` and `text`, and scheduled sends can't be cancelled through it. For those, call the API directly as shown above. [Schedule an email](/docs/guides/schedule-email) lists every adapter that accepts `sendAt` and how far ahead each provider allows. SendGrid has no idempotency key, so the SDK's `idempotencyKey` send option has nothing to map to on this adapter.

### How the fallback behaves

`retry: { maxAttempts: 3 }` allows three calls to SendGrid in total, with a short exponential backoff between them. The SDK retries `408`, `409`, `425`, `429`, and `5xx` responses and most network errors; other `4xx` errors fail at once. Without SendGrid idempotency, a retried `5xx` carries the same duplicate risk described above.

After the last attempt, the fallback decision depends on whether SendGrid might have accepted the message. A definite rejection, such as a 401 or 422, proves SendGrid refused the request, so the adapter reports `delivery: "not_sent"` and Postmark takes over even with the default policy. A timeout, a network error, a 408, 409 or 429, or a 5xx can't prove that, so it is `delivery: "unknown"`. For those, the default `onUnknownDelivery: "stop"` throws an `EmailRouteError` and never calls Postmark. The client above sets `onUnknownDelivery: "continue"`, which accepts a possible duplicate in exchange for not losing the email. [Retries and fallback](/docs/concepts/fallbacks-and-retries) explains the trade-off.

Before the first request, the client checks the message against every adapter in the route. That matters with Postmark as the fallback: Postmark takes one tag per message and has no scheduled sending, so a message with two tags or a `sendAt` fails with an `EmailValidationError` before SendGrid is called. Send those through a route without Postmark, or pick a fallback such as Mailgun that schedules too. [Postmark vs SendGrid](/compare/postmark-vs-sendgrid) lists every field side by side.

### Test without a network

`@opencoredev/email-sdk/testing` exports a `memoryAdapter` that records messages instead of sending them. [Test email behavior](/docs/guides/test-email-behavior) covers failure cases too:

`email.test.ts`:

```ts
import { expect, test } from "bun:test";

import { createEmailClient } from "@opencoredev/email-sdk";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";

test("sends the order confirmation", async () => {
  const memory = memoryAdapter();
  const email = createEmailClient({ adapters: [memory] });

  await email.send({ from: "orders@acme.com", to: "ada@example.com", subject: "Order confirmed", text: "Thanks." });

  expect(memory.raw?.sent).toHaveLength(1);
  expect(memory.raw?.sent[0]?.message.subject).toBe("Order confirmed");
});
```

Point production at `sendgrid(...)` and tests at `memoryAdapter()`, and the code between them doesn't change.

### Check the setup from the CLI

```bash
SENDGRID_API_KEY="SG...." npx --package @opencoredev/email-sdk email-sdk doctor --adapter sendgrid
```

The [adapter reference](/docs/adapters/sendgrid#verify-from-the-cli) shows a dry-run send as well.

## When to use SendGrid's own SDK

Twilio publishes [`@sendgrid/mail`](https://www.npmjs.com/package/@sendgrid/mail) (version 8.1 as of November 2026) for sending and `@sendgrid/client` for the rest of the v3 API, with `setDataResidency("eu")` for EU subusers. Use them, or raw `fetch`, for dynamic templates by ID, batch IDs, contacts, Marketing Campaigns, and account settings. Use Email SDK when you want send code that keeps working if you add a fallback provider or switch providers later.

All code on this page was typechecked against `@opencoredev/email-sdk` 3.0.1. The Email SDK, retry, and webhook examples ran against a stubbed `fetch` and a locally generated key pair. No real email was sent.

## Related

- [SendGrid adapter reference](/docs/adapters/sendgrid): every adapter option, capability, and CLI check.
- [SendGrid alternatives](/blog/sendgrid-alternatives): moving off SendGrid with SendGrid kept as the fallback.
- [Postmark vs SendGrid](/compare/postmark-vs-sendgrid), [Resend vs SendGrid](/compare/resend-vs-sendgrid), and [SendGrid vs Mailgun](/compare/sendgrid-vs-mailgun): SendGrid's message fields next to other providers.
- [Mailgun API guide](/blog/mailgun-api-nodejs-typescript), [Resend API guide](/blog/resend-api-nodejs-typescript), and [Brevo API guide](/blog/brevo-api-nodejs-typescript): the same walkthrough for other providers.
- [How to send email from Node.js and TypeScript](/blog/send-email-nodejs-typescript): SMTP, a provider's HTTP API, or one client for any provider.
