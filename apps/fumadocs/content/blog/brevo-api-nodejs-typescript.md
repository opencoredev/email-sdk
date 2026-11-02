# Brevo API Guide for Node.js and TypeScript

This guide calls the Brevo transactional email API from Node.js and TypeScript with plain `fetch`. It covers the `api-key` header, sending, templates and `params`, attachments, scheduling, batch sends with `messageVersions`, idempotency keys, errors, rate limits, sandbox mode, and webhooks. The last section sends the same email through Email SDK's `brevo` adapter with Mailgun as a fallback.

Every Brevo detail on this page was checked against [Brevo's API documentation](https://developers.brevo.com/docs) in November 2026. Already using Email SDK? The [Brevo adapter reference](/docs/adapters/brevo) lists every option, and [SendGrid vs Brevo](/compare/sendgrid-vs-brevo) puts Brevo's message fields next to another provider.

## What you need

- A Brevo account with a verified sender or an authenticated domain. The [email DNS checker](/tools/email-dns-checker) shows whether SPF, DKIM, and DMARC resolve for your domain.
- An API key, covered in the next section. Brevo's free plan sends up to 300 emails a day once your account is approved for sending ([Brevo pricing](https://www.brevo.com/pricing/), checked Nov 2026).
- A server runtime with `fetch` built in, such as Node.js 20+ or Bun. Keep the key on the server: anyone who has it can send mail as you and read your contacts.

## Authenticate with an API key

Create a key on the [SMTP & API settings page](https://app.brevo.com/settings/keys/api). Brevo shows it once, so copy it into your secret store right away. Keys start with `xkeysib-`.

Brevo doesn't use a bearer token for API keys. Every request carries the key in an `api-key` header and goes to `https://api.brevo.com/v3` ([API key authentication](https://developers.brevo.com/docs/api-key-authentication), checked Nov 2026). `GET /v3/account` is a cheap way to check a key:

```bash
curl https://api.brevo.com/v3/account -H "api-key: $BREVO_API_KEY"
```

An API key has access to the whole account. For new server-to-server integrations Brevo also offers [OAuth 2.0 machine-to-machine tokens](https://developers.brevo.com/docs/oauth-m2m-authentication), which are scoped and short-lived and go in an `Authorization: Bearer` header instead.

Brevo can also restrict API access to [authorized IP addresses](https://developers.brevo.com/docs/ip-security). With "Block unknown IP addresses" turned on, requests from any other IP are rejected even with a valid key. A send that works on your laptop and fails from a new server or a serverless function is often this setting, so add the server's IPs (CIDR ranges work) before you deploy.

## Send an email with fetch

The endpoint is `POST /v3/smtp/email` with a JSON body ([Send a transactional email](https://developers.brevo.com/reference/send-transac-email), checked Nov 2026). Without a template, `sender`, `to`, `subject`, and `htmlContent` (or `textContent`) are required. Addresses are objects with an `email` and an optional `name`, never `"Name <email>"` strings.

This script sends an order confirmation with a Reply-To address, a tag, a custom header, and a PDF attachment:

`send-fetch.ts`:

```ts
import { readFile } from "node:fs/promises";

const apiKey = process.env.BREVO_API_KEY;

if (!apiKey) throw new Error("Set BREVO_API_KEY.");

const pdf = await readFile(new URL("./invoice.pdf", import.meta.url));

const response = await fetch("https://api.brevo.com/v3/smtp/email", {
  method: "POST",
  headers: {
    "api-key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({
    sender: { name: "Acme", email: "orders@acme.com" },
    to: [{ email: "ada@example.com", name: "Ada Lovelace" }],
    replyTo: { email: "support@acme.com" },
    subject: "Your Acme order is confirmed",
    htmlContent: "<p>Thanks for your order. Your invoice is attached.</p>",
    textContent: "Thanks for your order. Your invoice is attached.",
    tags: ["order-confirmation"],
    headers: { "X-Mailin-custom": "order_id:ord_123" },
    attachment: [{ name: "invoice.pdf", content: pdf.toString("base64") }],
  }),
});

const body: unknown = await response.json();

if (!response.ok) throw new Error(`Brevo ${response.status}: ${JSON.stringify(body)}`);

console.log(body); // { messageId: "<...@smtp-relay.mailin.fr>" }
```

A sent email returns `201` with a `messageId`. A scheduled one returns `202`. Store the `messageId`: it's how you look up the email in Brevo's logs, cancel a scheduled send, and match webhook events.

The body fields you'll use most:

| Field | Type | Notes |
| --- | --- | --- |
| `sender` | `{ email, name? }` or `{ id }` | `id` picks a saved sender, for example one tied to a dedicated IP. |
| `to`, `cc`, `bcc` | array of `{ email, name? }` | Display names are capped at 70 characters. |
| `replyTo` | `{ email, name? }` | One address, not an array. |
| `htmlContent`, `textContent` | string | Ignored when you send a `templateId`. |
| `templateId`, `params` | number, object | See the next section. |
| `tags` | array of strings | For filtering logs and webhook events. |
| `headers` | object | Custom headers only; standard headers such as `From` aren't supported here. |
| `attachment` | array | Note the singular name. Each item has `name` plus `content` (Base64) or `url`. |
| `scheduledAt` | ISO 8601 date-time | Up to 72 hours ahead. |

Brevo converts custom header names to Title-Case. `X-Mailin-custom` is the exception worth knowing: its value comes back in every webhook event, which makes it a good place for your own order or user ID.

## Templates and params

Brevo can render a template you built in its dashboard. Send `templateId` instead of `htmlContent`, and pass the variables in `params`. The template reads them as `{{ params.firstName }}`:

```json
{
  "templateId": 12,
  "to": [{ "email": "ada@example.com" }],
  "params": { "firstName": "Ada", "orderId": "ord_123" }
}
```

The template's sender and subject apply unless you send your own. `params` only works with templates in Brevo's New Template Language; old-format templates ignore it, and they ignore attachments too.

## Attachments

Each attachment needs a `name` and either `content` (the file as Base64) or `url` (an absolute URL Brevo fetches). Brevo only supports a fixed list of file extensions, including pdf, csv, ics, png, jpg, zip, docx, and xlsx, so check the [full list](https://developers.brevo.com/reference/send-transac-email) before you attach anything unusual.

## Schedule an email

Set `scheduledAt` to an ISO 8601 date-time with a timezone, at most 72 hours ahead ([Schedule emails](https://developers.brevo.com/docs/schedule-batch-sendings), checked Nov 2026). Brevo answers `202` and may send up to 5 minutes late.

```json
{ "scheduledAt": "2026-11-03T09:00:00.000Z", "batchId": "5a1c6c0e-8d84-4b5e-9a5f-5f2f9c3e1f10" }
```

`batchId` is an optional UUID that groups scheduled sends. To check or cancel them, pass the `batchId`, or the `messageId` of a single email, to `GET /v3/smtp/emailStatus/{identifier}` and `DELETE /v3/smtp/email/{identifier}`. Anything further out than 72 hours belongs in your own job queue.

## Send a batch with messageVersions

One request can carry up to 2,000 recipients split into versions, each with its own `to`, `subject`, and `params` ([Batch send](https://developers.brevo.com/docs/batch-send-transactional-emails), checked Nov 2026). A version holds at most 99 recipients, and each version's `params` must stay under 100 KB.

`send-batch.ts`:

```ts
const apiKey = process.env.BREVO_API_KEY;

if (!apiKey) throw new Error("Set BREVO_API_KEY.");

const response = await fetch("https://api.brevo.com/v3/smtp/email", {
  method: "POST",
  headers: { "api-key": apiKey, "Content-Type": "application/json" },
  body: JSON.stringify({
    sender: { name: "Acme", email: "orders@acme.com" },
    subject: "Your order has shipped",
    htmlContent: "<p>Hi {{ params.firstName }}, order {{ params.orderId }} is on its way.</p>",
    messageVersions: [
      { to: [{ email: "ada@example.com" }], params: { firstName: "Ada", orderId: "ord_123" } },
      { to: [{ email: "grace@example.com" }], params: { firstName: "Grace", orderId: "ord_124" } },
    ],
  }),
});

console.log(response.status, await response.json());
```

Versions can only override `htmlContent` or `textContent` when the top level already has one of them, so keep a default body at the top.

## Idempotency keys

A retry after a timeout can send the same email twice, because the first request may have gone through. Brevo's guard is an `idempotencyKey` inside the body's `headers` object, not an HTTP header ([Idempotency](https://developers.brevo.com/docs/heterogenous-versions-batch-emails), checked Nov 2026):

```json
{ "headers": { "idempotencyKey": "9b2f6a0e-3c4d-4e5f-8a9b-0c1d2e3f4a5b" } }
```

The key must be a UUID, and it lasts 30 minutes. A second request with the same key inside that window gets a `400` with code `duplicate_parameter` and sends nothing. Generate one key per logical email and reuse it on every retry of that email. After 30 minutes the key no longer protects you.

## Errors and rate limits

Error bodies carry a `code` and a `message`, such as `{ "code": "missing_parameter", "message": "..." }` ([Send a transactional email](https://developers.brevo.com/reference/send-transac-email), checked Nov 2026).

| Status | Common `code` | What to do |
| --- | --- | --- |
| `400` | `missing_parameter`, `invalid_parameter`, `out_of_range` | Fix the request. Retrying sends the same error. |
| `400` | `duplicate_parameter` | With an idempotency key, the email already went out. Treat it as sent. |
| `400` | `not_enough_credits` | Your plan's sending allowance is used up. Retrying won't help. |
| `401` | `unauthorized` | Check the key, and the authorized IPs list if it's on. |
| `429` | | Rate limited. Wait for the reset. |
| `5xx` | | Retry with backoff and the same idempotency key. |

The send endpoint is generous: 1,000 requests per second on the general tier, 2,000 on Professional, and more on Enterprise ([Rate limits](https://developers.brevo.com/docs/api-limits), checked Nov 2026). Most other endpoints are far lower, and everything else under `/v3/smtp/` shares 300 requests an hour on the general tier, so polling logs or email status in a loop runs out long before sending does. Responses carry `x-sib-ratelimit-limit`, `x-sib-ratelimit-remaining`, and `x-sib-ratelimit-reset`, the last one in seconds.

This helper retries network errors, timeouts, `429`, and `5xx` with the same idempotency key on every attempt. Each attempt times out after 10 seconds, and any single wait is capped at 30 seconds:

`send-with-retry.ts`:

```ts
type BrevoEmail = Record<string, unknown> & { headers?: Record<string, string> };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function sendWithRetry(email: BrevoEmail, apiKey: string, maxAttempts = 3) {
  const idempotencyKey = crypto.randomUUID();
  const body = JSON.stringify({ ...email, headers: { ...email.headers, idempotencyKey } });

  for (let attempt = 1; ; attempt++) {
    let response: Response;

    try {
      response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: { "api-key": apiKey, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      if (attempt >= maxAttempts) throw error;
      await sleep(Math.min(2 ** attempt * 500, 30_000));
      continue;
    }

    const result: { messageId?: string; code?: string; message?: string } = await response.json().catch(() => ({}));

    if (response.ok) return { messageId: result.messageId, idempotencyKey };
    // An earlier attempt reached Brevo, so this email is already on its way.
    if (response.status === 400 && result.code === "duplicate_parameter") return { messageId: undefined, idempotencyKey };

    const retryable = response.status === 429 || response.status >= 500;

    if (!retryable || attempt >= maxAttempts) {
      throw new Error(`Brevo ${response.status} ${result.code ?? ""}: ${result.message ?? ""}`);
    }

    const reset = Number(response.headers.get("x-sib-ratelimit-reset"));
    const waitMs = Number.isFinite(reset) && reset > 0 ? reset * 1000 : 2 ** attempt * 500;
    await sleep(Math.min(waitMs, 30_000));
  }
}
```

When Brevo reports a duplicate, the helper returns no `messageId`, because the response doesn't carry the first attempt's ID. Look it up in Brevo's logs by recipient if you need it.

## Test without emailing anyone

Add `"X-Sib-Sandbox": "drop"` to the body's `headers` ([Sandbox mode](https://developers.brevo.com/docs/using-sandbox-mode), checked Nov 2026). Brevo validates the request and returns `201` with a `messageId`, but sends nothing and writes no log. That proves your key, sender, and payload shape. It doesn't prove delivery, so do one real send to an inbox you own before launch.

## Webhooks

Brevo posts delivery events to a URL you register in the dashboard or with `POST /v3/webhooks` ([Create a webhook](https://developers.brevo.com/reference/create-webhook), checked Nov 2026). For transactional email you can subscribe to `sent`, `delivered`, `hardBounce`, `softBounce`, `blocked`, `spam`, `invalid`, `deferred`, `click`, `opened`, `uniqueOpened`, and `unsubscribed`.

The payload names differ from the subscription names: a `hardBounce` subscription delivers `"event": "hard_bounce"`, `invalid` delivers `invalid_email`, and `sent` delivers `request` ([Transactional webhooks](https://developers.brevo.com/docs/transactional-webhooks), checked Nov 2026). Each event carries the recipient `email`, `message-id`, `tags`, your `X-Mailin-custom` value, and timestamps. `ts_event` and `ts_epoch` are UTC; the `date` string is in CET/CEST. The send response wraps `messageId` in angle brackets while the documented webhook sample doesn't, so strip `<` and `>` from both before you match them.

Brevo doesn't sign webhook payloads. To make sure a request came from Brevo, register the webhook with a bearer token (`"auth": { "type": "bearer", "token": "..." }`) or basic auth in the URL, and optionally allow only [Brevo's IP ranges](https://help.brevo.com/hc/en-us/articles/208848409) ([Secure webhook calls](https://developers.brevo.com/docs/secured-webhooks), checked Nov 2026). Then check the token in your handler:

`webhook.ts`:

```ts
import { timingSafeEqual } from "node:crypto";

type BrevoEvent = { event: string; email: string; "message-id"?: string; tags?: string[] };

function tokenMatches(header: string | null, expected: string) {
  const given = Buffer.from(header ?? "");
  const wanted = Buffer.from(`Bearer ${expected}`);

  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export async function handleBrevoWebhook(request: Request) {
  if (!tokenMatches(request.headers.get("authorization"), process.env.BREVO_WEBHOOK_TOKEN!)) {
    return new Response("Unauthorized", { status: 401 });
  }

  const event: BrevoEvent = await request.json();
  const messageId = event["message-id"]?.replace(/^<|>$/g, "");

  if (event.event === "hard_bounce" || event.event === "spam" || event.event === "blocked") {
    console.log("suppress recipient", event.email, messageId);
  }

  return new Response("ok");
}
```

With `"batched": true`, Brevo collects events for up to 5 minutes and sends up to 500 in one request ([Batched webhooks](https://developers.brevo.com/docs/batch-webhooks), checked Nov 2026). The handler above expects one event per request, so adjust it before you turn batching on.

## The same email with Email SDK

Email SDK wraps the send path above in a typed client. The `brevo` adapter builds the same JSON request with the `api-key` header, and lets you list a second provider for when Brevo fails.

```bash
npm install @opencoredev/email-sdk
```

Create the client once. This one sends through Brevo and falls back to Mailgun, which carries every message field Brevo does, including metadata and scheduling:

`email.ts`:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { brevo } from "@opencoredev/email-sdk/brevo";
import { mailgun } from "@opencoredev/email-sdk/mailgun";

export const email = createEmailClient({
  adapters: [
    brevo({ apiKey: process.env.BREVO_API_KEY! }),
    mailgun({ apiKey: process.env.MAILGUN_API_KEY!, domain: "mg.acme.com" }),
  ],
  defaultAdapter: "brevo",
  retry: { maxAttempts: 3 },
  fallback: { adapters: ["mailgun"], onUnknownDelivery: "continue" },
});
```

Then send the order email from the first example. Email SDK takes addresses as strings or `{ email, name }` objects, and headers as an array of `{ name, value }` pairs:

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
  headers: [{ name: "X-Mailin-custom", value: "order_id:ord_123" }],
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

The adapter posts to `https://api.brevo.com/v3/smtp/email` ([`brevo.ts`](https://github.com/opencoredev/email-sdk/blob/main/packages/email-sdk/src/brevo.ts)):

| Email SDK field | Brevo field |
| --- | --- |
| `from` | `sender` as `{ email, name }` |
| `to`, `cc`, `bcc` | arrays of `{ email, name }` |
| `replyTo` | `replyTo`; two or more addresses throw an `EmailValidationError` before any request |
| `html`, `text` | `htmlContent`, `textContent` |
| `headers` (array of `{ name, value }`) | `headers` object |
| `tags` | `tags`, values only (the tag `name` is dropped) |
| `metadata` | `params`, the values Brevo templates read |
| `sendAt` | `scheduledAt` as an ISO 8601 timestamp |
| `attachments` | `attachment`, with `name` and Base64 `content` |

`result.id` is the ID from the provider named in `result.adapter`: Brevo's `messageId` when Brevo sends, or Mailgun's message ID when the fallback does. Store both fields so you look up the message and match webhooks with the right provider.

Two Brevo features have no Email SDK field. The adapter doesn't send `templateId`, so it renders your own `html` and `text`, and `metadata` reaches your content only as `params`. It also doesn't forward the SDK's `idempotencyKey` send option, because Brevo's key lives in the body rather than an HTTP header. If you want Brevo's duplicate guard, put a UUID `idempotencyKey` in `headers` yourself; when the fallback sends, Mailgun receives that entry as an ordinary custom header.

### How the fallback behaves

`retry: { maxAttempts: 3 }` allows three calls to Brevo in total, with a short exponential backoff between them. The SDK retries `408`, `409`, `425`, `429`, and `5xx` responses and most network errors; other `4xx` errors fail at once.

After the last attempt, the fallback decision depends on whether Brevo might have accepted the message. The adapter can't prove a failed request was never accepted, so it reports every failure, HTTP error or network error, as `delivery: "unknown"`. With the default `onUnknownDelivery: "stop"`, the client throws an `EmailRouteError` and never calls Mailgun. The client above sets `onUnknownDelivery: "continue"`, which accepts a possible duplicate in exchange for not losing the email. [Retries and fallback](/docs/concepts/fallbacks-and-retries) explains the trade-off.

Before the first request, the client checks the message against every adapter in the route, so a field Mailgun can't carry fails with an `EmailValidationError` instead of being dropped halfway. A `sendAt` more than 72 hours out passes that check and is then refused by Brevo, so keep long delays in your own queue.

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

Point production at `brevo(...)` and tests at `memoryAdapter()`, and the code between them doesn't change.

### Check the setup from the CLI

```bash
BREVO_API_KEY="xkeysib-..." npx --package @opencoredev/email-sdk email-sdk doctor --adapter brevo
```

The [adapter reference](/docs/adapters/brevo#verify-from-the-cli) shows a dry-run send as well.

## When to use Brevo's own SDK

Brevo publishes an official Node.js SDK, [`@getbrevo/brevo`](https://developers.brevo.com/guides/node-js) (version 6 as of November 2026), with typed clients for the whole API, built-in retries, and support for Node.js 18+, Bun, Deno, and Cloudflare Workers. Use it, or raw `fetch`, for templates by ID, contacts, campaigns, SMS, and account settings. Use Email SDK when you want send code that keeps working if you add a fallback provider or switch providers later.

All code on this page was typechecked against `@opencoredev/email-sdk` 3.0.1, and the Email SDK and retry examples ran against a stubbed `fetch`. No real email was sent.

## Related

- [Brevo adapter reference](/docs/adapters/brevo): every adapter option, capability, and CLI check.
- [SendGrid vs Brevo](/compare/sendgrid-vs-brevo) and [Brevo vs MailerSend](/compare/brevo-vs-mailersend): Brevo's message fields next to other providers.
- [Mailgun API guide](/blog/mailgun-api-nodejs-typescript): the fallback provider used here, called with plain `fetch`.
- [Resend API guide](/blog/resend-api-nodejs-typescript): the same walkthrough for Resend.
- [SendGrid alternatives](/blog/sendgrid-alternatives): moving off SendGrid with SendGrid kept as the fallback.
- [How to send email from Node.js and TypeScript](/blog/send-email-nodejs-typescript): SMTP, a provider's HTTP API, or one client for any provider.
