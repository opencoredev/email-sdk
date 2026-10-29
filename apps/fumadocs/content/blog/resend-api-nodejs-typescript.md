# Resend API Guide for Node.js and TypeScript

This guide calls the Resend Email API from Node.js and TypeScript with plain `fetch`, so you can see every header Resend expects and every response it sends back. It covers API keys, sending, attachments, scheduling, idempotency keys, batch sends, errors, rate limits, and webhook signatures. The last section sends the same email through Email SDK's `resend` adapter and adds a second provider as a fallback.

Every Resend detail on this page was checked against [Resend's API reference](https://resend.com/docs/api-reference/introduction) in October 2026. Already using Email SDK? The [Resend adapter reference](/docs/adapters/resend) lists every option, and the [Resend comparisons](/compare/resend-vs-postmark) put its message fields next to other providers.

## What you need

- A Resend account and a verified sending domain. Until a domain is verified, Resend only lets you send test emails to your own address, and every other recipient gets a `403` ([Errors](https://resend.com/docs/api-reference/errors), checked Oct 2026). The [email DNS checker](/tools/email-dns-checker) shows whether SPF, DKIM, and DMARC resolve for your domain.
- An API key, covered in the next section.
- A server runtime with `fetch` built in, such as Node.js 20+ or Bun. Keep this code on the server: an API key in a browser bundle lets anyone send mail from your domain.

## Authenticate with an API key

Resend uses a bearer token. Every request carries `Authorization: Bearer re_...` and goes to `https://api.resend.com` over HTTPS ([Introduction](https://resend.com/docs/api-reference/introduction), checked Oct 2026).

Resend also rejects requests without a `User-Agent` header with a `403` and error code `1010`. Node's and Bun's built-in `fetch` send one by default, so this only bites if a proxy or custom HTTP client strips it.

A key has one of two permissions ([Create API key](https://resend.com/docs/api-reference/api-keys/create-api-key), checked Oct 2026):

| Permission | What it can do | Use it for |
| --- | --- | --- |
| `full_access` | Create, read, update, and delete any resource | Admin scripts, domain and webhook setup |
| `sending_access` | Send email only, optionally limited to one domain | The send path in your application |

Give your app a `sending_access` key scoped to its domain. Resend shows the key value once, so copy it into your secret store right away. A sending key that calls any other endpoint gets `401 restricted_api_key`.

## Send an email with fetch

The endpoint is `POST /emails` with a JSON body ([Send Email](https://resend.com/docs/api-reference/emails/send-email), checked Oct 2026). `from`, `to`, and `subject` are required, plus a body: `html`, `text`, or a published `template`. If you send only `html`, Resend generates the plain text version for you. `to` takes one address or an array of up to 50.

This script sends an invoice email with a tag, a Reply-To address, a custom header, and a PDF attachment:

`send-fetch.ts`:

```ts
import { readFile } from "node:fs/promises";

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) throw new Error("Set RESEND_API_KEY.");

const pdf = await readFile(new URL("./invoice.pdf", import.meta.url));

const response = await fetch("https://api.resend.com/emails", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Idempotency-Key": "invoice-email/ord_123",
  },
  body: JSON.stringify({
    from: "Acme <billing@acme.com>",
    to: ["Ada Lovelace <ada@example.com>"],
    reply_to: "support@acme.com",
    subject: "Your invoice from Acme",
    html: "<p>Thanks for your order. Your invoice is attached.</p>",
    text: "Thanks for your order. Your invoice is attached.",
    tags: [{ name: "type", value: "invoice" }],
    headers: { "X-Order-Id": "ord_123" },
    attachments: [{ filename: "invoice.pdf", content: pdf.toString("base64") }],
  }),
});

const body: unknown = await response.json();

if (!response.ok) throw new Error(`Resend returned ${response.status}: ${JSON.stringify(body)}`);

if (typeof body !== "object" || body === null || !("id" in body) || typeof body.id !== "string") {
  throw new Error("Resend response has no email id.");
}

console.log(body.id);
```

A successful send returns `200` with a JSON body holding only `id`. Store it: the same ID shows up in the dashboard, in the Retrieve Email endpoint, and as `data.email_id` in webhook payloads.

Field names are snake_case on the wire: `reply_to`, `scheduled_at`, and `content_type` inside attachments.

### Tags

Tags are `{ name, value }` pairs that come back in webhook events, so you can match events to your own records. Names and values may only contain ASCII letters, numbers, underscores, and dashes, up to 256 characters each ([Send Email](https://resend.com/docs/api-reference/emails/send-email), checked Oct 2026). An order ID like `ord_123` fits. An email address or a value with spaces gets a `400 validation_error`.

Resend has no separate metadata field. If you need to attach data that doesn't fit the tag character set, keep it in your database keyed by the email `id`.

## Attachments and inline images

Each entry in `attachments` takes either `content`, the file as a Base64 string, or `path`, a URL Resend downloads the file from ([Attachments](https://resend.com/docs/dashboard/emails/attachments), checked Oct 2026). The whole email can carry up to 40 MB of attachments after Base64 encoding. Base64 adds about a third, so the raw files need to stay under roughly 30 MB.

For an image inside the HTML body, give the attachment a `content_id` and reference it as `cid:`:

```ts
const logo = await readFile(new URL("./logo.png", import.meta.url));

const attachments = [{ filename: "logo.png", content: logo.toString("base64"), content_id: "logo" }];
const html = '<p><img src="cid:logo" alt="Acme"></p><p>Your order shipped.</p>';
```

`content_type` is optional. Without it, Resend derives the type from the filename.

## Schedule an email

Add `scheduled_at` to send later. It takes an ISO 8601 timestamp such as `2026-11-02T14:00:00.000Z`, or natural language such as `"in 1 hour"` or `"tomorrow at 9am"`. Emails can be scheduled up to 30 days ahead, and a scheduled email can be rescheduled or canceled until it goes out ([Schedule email](https://resend.com/docs/dashboard/emails/schedule-email), checked Oct 2026).

Prefer ISO timestamps built from a `Date` in application code (`sendAt.toISOString()`). Natural language is handy from the command line, but its meaning depends on how Resend parses the phrase and on the time zone you name.

## Idempotency keys: retries without duplicates

Most email APIs can't tell you whether a request that timed out was sent. Resend can, if you send an `Idempotency-Key` header. Resend remembers each key for 24 hours. A repeat request with the same key and the same body gets the original response back, and no second email goes out ([Idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), checked Oct 2026).

- Keys are 1 to 256 characters. Resend suggests building them from the event and entity, like `welcome-user/123456789`, so the same business event always produces the same key.
- Reusing a key with a different body returns `409 invalid_idempotent_request`. Retrying that request is pointless: change the key or fix the payload.
- A repeat while the first request is still running returns `409 concurrent_idempotent_requests`. That one is safe to retry later.

Idempotency only works if the key comes from your data. A random UUID generated inside the retry loop gives each attempt a new key, and each attempt sends a new email.

## Errors and rate limits

Resend returns standard HTTP status codes, and error bodies carry a `name` such as `validation_error` and a human-readable `message` ([Errors](https://resend.com/docs/api-reference/errors), checked Oct 2026).

| Status | Common `name` | What to do |
| --- | --- | --- |
| `400` | `validation_error`, `invalid_idempotency_key` | Fix the request. Retrying sends the same error. |
| `401` | `missing_api_key`, `restricted_api_key` | Check the key, and that a sending key isn't calling an admin endpoint. |
| `403` | `validation_error` | Usually an unverified domain or a `from` address on another domain. |
| `409` | `invalid_idempotent_request`, `concurrent_idempotent_requests` | See the idempotency section above. |
| `422` | `missing_required_field`, `invalid_attachment` | Fix the request. |
| `429` | `rate_limit_exceeded`, `daily_quota_exceeded`, `monthly_quota_exceeded` | Wait for a rate limit. A quota error won't clear by retrying soon. |
| `500`, `503` | `application_error`, `service_unavailable` | Retry with backoff. |

The default rate limit is 10 requests per second per team, shared by every API key on the team ([Usage limits](https://resend.com/docs/api-reference/rate-limit), checked Oct 2026). Responses carry `ratelimit-limit`, `ratelimit-remaining`, `ratelimit-reset`, and `retry-after`, all in seconds. Free plans also have a daily quota that resets at midnight UTC.

This helper retries `429` rate limits and `5xx` errors with the same idempotency key on every attempt. It waits for `retry-after` when Resend sends one, caps any single wait at 30 seconds, and gives up on quota errors right away:

`send-with-retry.ts`:

```ts
type ResendSendResult = { ok: true; id: string } | { ok: false; status: number; name: string; message: string };

const retryable = new Set([429, 500, 502, 503, 504]);
const quotaErrors = new Set(["daily_quota_exceeded", "monthly_quota_exceeded"]);

export async function sendWithRetry(
  apiKey: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  maxAttempts = 3,
): Promise<ResendSendResult> {
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify(payload),
    });

    const body: unknown = await response.json().catch(() => undefined);

    if (response.ok) {
      const id = readString(body, "id");

      if (!id) return { ok: false, status: response.status, name: "missing_id", message: "Response has no email id." };

      return { ok: true, id };
    }

    const name = readString(body, "name") ?? "unknown_error";
    const message = readString(body, "message") ?? response.statusText;

    if (!retryable.has(response.status) || quotaErrors.has(name) || attempt >= maxAttempts) {
      return { ok: false, status: response.status, name, message };
    }

    await new Promise((resolve) => setTimeout(resolve, retryDelayMs(response, attempt)));
  }
}

function retryDelayMs(response: Response, attempt: number) {
  const backoff = 500 * 2 ** (attempt - 1);
  const retryAfter = Number(response.headers.get("retry-after")) * 1000;

  return Math.min(Math.max(backoff, Number.isFinite(retryAfter) ? retryAfter : 0), 30_000);
}

function readString(value: unknown, key: string): string | undefined {
  if (typeof value !== "object" || value === null || !(key in value)) return undefined;
  const field: unknown = Reflect.get(value, key);

  return typeof field === "string" ? field : undefined;
}
```

Because the key stays the same across attempts, a retry after a timeout or a `5xx` can't produce a second email within Resend's 24-hour window. Without the header, the same retry could deliver a duplicate.

## Send a batch

`POST /emails/batch` takes an array of up to 100 emails in one request and returns `data`, an array of `{ id }` in the same order as your input ([Send Batch Emails](https://resend.com/docs/api-reference/emails/send-batch-emails), checked Oct 2026). Batch sends accept an `Idempotency-Key` too. Use one that names the whole batch, such as `weekly-digest/2026-11-02`.

Batch emails can't carry `attachments`. Send those one at a time through `POST /emails`.

## Test without emailing real people

Resend provides test addresses that simulate an outcome without touching your domain's reputation: `delivered@resend.dev` and `bounced@resend.dev` among them. Add a label after `+`, as in `delivered+signup@resend.dev`, to tell test cases apart ([Send test emails](https://resend.com/docs/dashboard/emails/send-test-emails), checked Oct 2026). These still go through Resend's API. For unit tests that never leave your process, see the Email SDK `memoryAdapter` below.

## Webhooks

Resend posts events to your HTTPS endpoint as JSON ([Event types](https://resend.com/docs/dashboard/webhooks/event-types), checked Oct 2026). The email events you'll handle most:

| Event | Fires when |
| --- | --- |
| `email.sent` | The API request succeeded and Resend will try to deliver |
| `email.delivered` | The recipient's mail server accepted the message |
| `email.delivery_delayed` | Delivery hit a temporary problem, such as a full inbox |
| `email.bounced` | The recipient's server permanently rejected the message |
| `email.complained` | The recipient marked the message as spam |
| `email.failed` | Resend couldn't send, for example over a quota or domain problem |
| `email.suppressed` | Resend suppressed the message |
| `email.opened`, `email.clicked` | Open or click tracking recorded an event |

The payload has a `type`, a `created_at`, and a `data` object holding `email_id`, the addresses, the subject, and your tags.

### Verify the signature

Resend signs webhooks through Svix. Each request carries three headers: `svix-id`, `svix-timestamp`, and `svix-signature`. The signature is an HMAC-SHA256 over `{svix-id}.{svix-timestamp}.{raw body}`, keyed with the Base64 part of your signing secret after the `whsec_` prefix. `svix-signature` holds one or more space-separated `v1,<base64 signature>` entries ([Verify webhook requests](https://resend.com/docs/dashboard/webhooks/verify-webhooks-requests) and [Svix manual verification](https://docs.svix.com/receiving/verifying-payloads/how-manual), checked Oct 2026).

Verify against the raw body text. Parsing the JSON and serializing it again changes the bytes, and the signature no longer matches.

`verify-webhook.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

const toleranceSeconds = 5 * 60;

export function verifyResendSignature(secret: string, headers: Headers, rawBody: string) {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatures = headers.get("svix-signature");

  if (!id || !timestamp || !signatures) return false;

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));

  if (!Number.isFinite(age) || age > toleranceSeconds) return false;

  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();

  return signatures.split(" ").some((entry) => {
    const [version, signature] = entry.split(",");

    if (version !== "v1" || !signature) return false;
    const received = Buffer.from(signature, "base64");

    return received.length === expected.length && timingSafeEqual(received, expected);
  });
}
```

The timestamp check limits replays to a five-minute window. Within it, the same signed request is still valid, so store each `svix-id` you've processed and skip repeats. That also absorbs Resend's own retries.

### Respond with the right status

Return a `2xx` once you've stored the event. Anything else makes Resend retry: immediately, then after 5 seconds, 5 minutes, 30 minutes, 2 hours, 5 hours, 10 hours, and 10 hours again. An endpoint that keeps failing gets disabled, and Resend emails your team ([Retries and replays](https://resend.com/docs/webhooks/retries-and-replays), checked Oct 2026). You can replay any message from the dashboard.

## The same email with Email SDK

Email SDK wraps the send path above in a typed client. The `resend` adapter builds the same JSON request, forwards your idempotency key as the `Idempotency-Key` header, and lets you list a second provider for when Resend fails.

```bash
npm install @opencoredev/email-sdk
```

Create the client once. This one sends through Resend and falls back to Postmark:

`email.ts`:

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
  retry: { maxAttempts: 3 },
  fallback: { adapters: ["postmark"], onUnknownDelivery: "continue" },
});
```

Then send the invoice email from the first example. Email SDK takes headers as an array of `{ name, value }` pairs and builds Resend's header object for you:

`send-sdk.ts`:

```ts
import { readFile } from "node:fs/promises";

import { email } from "./email";

const result = await email.send(
  {
    from: "Acme <billing@acme.com>",
    to: { email: "ada@example.com", name: "Ada Lovelace" },
    replyTo: "support@acme.com",
    subject: "Your invoice from Acme",
    html: "<p>Thanks for your order. Your invoice is attached.</p>",
    text: "Thanks for your order. Your invoice is attached.",
    tags: [{ name: "type", value: "invoice" }],
    headers: [{ name: "X-Order-Id", value: "ord_123" }],
    attachments: [
      {
        filename: "invoice.pdf",
        content: await readFile(new URL("./invoice.pdf", import.meta.url)),
        contentType: "application/pdf",
      },
    ],
  },
  { idempotencyKey: "invoice-email/ord_123" },
);

console.log(result.adapter, result.id);
```

The adapter posts to `https://api.resend.com/emails` with the fields you built by hand ([`resend.ts`](https://github.com/opencoredev/email-sdk/blob/main/packages/email-sdk/src/resend.ts)):

| Email SDK field | Resend field |
| --- | --- |
| `to`, `cc`, `bcc` | `to`, `cc`, `bcc` as formatted address strings |
| `replyTo` | `reply_to` |
| `headers` (array of `{ name, value }`) | `headers` object |
| `tags` | `tags` |
| `sendAt` | `scheduled_at` as an ISO 8601 timestamp |
| `attachments` | `attachments`, with `content` Base64-encoded and `contentId` as `content_id` |
| `idempotencyKey` send option | `Idempotency-Key` header |

`result.id` is Resend's email ID. `metadata` on a message throws an `EmailValidationError` before any request, because Resend has no metadata field. Use `tags` for values that fit Resend's character rules.

### How the fallback behaves

`retry: { maxAttempts: 3 }` allows three calls to Resend in total, with a short exponential backoff between them. Every attempt carries the same idempotency key, so Resend's retries can't double-send. The SDK's default backoff doesn't read `retry-after`.

After the last attempt, the fallback decision depends on whether Resend might have accepted the message. The adapter can't prove a failed request was never accepted, so it reports every failure, HTTP error or network error, as `delivery: "unknown"`. With the default `onUnknownDelivery: "stop"`, the client throws an `EmailRouteError` and never calls Postmark. The client above sets `onUnknownDelivery: "continue"`, which accepts a possible duplicate in exchange for not losing the email: Resend's idempotency key protects retries to Resend, not a second copy sent through Postmark. [Retries and fallback](/docs/concepts/fallbacks-and-retries) explains the trade-off.

Before the first request, the client checks the message against every adapter in the route. Postmark has no scheduled sending and takes one tag per message, so a message with `sendAt` or two tags fails with `EmailValidationError` while Postmark is in the fallback list. Send those through Resend alone:

```ts
await email.send(scheduledMessage, { fallback: { adapters: [] } });
```

### Verify webhooks with Email SDK

`@opencoredev/email-sdk/webhooks` checks the same Svix signature and normalizes the payload:

`webhook-sdk.ts`:

```ts
import { normalizeWebhookEvent, verifyResendWebhook } from "@opencoredev/email-sdk/webhooks";

const processed = new Set<string>();

export async function handleResendWebhook(request: Request) {
  const body = await request.text();

  const valid = await verifyResendWebhook({
    body,
    headers: request.headers,
    secret: process.env.RESEND_WEBHOOK_SECRET!,
  });

  if (!valid) return new Response("Invalid signature", { status: 401 });

  const event = await normalizeWebhookEvent({ provider: "resend", body, headers: request.headers });

  if (processed.has(event.deliveryId)) return new Response("ok");
  processed.add(event.deliveryId);

  if (event.status === "bounced" || event.status === "complained") {
    console.log("suppress recipient", event.providerMessageId, event.type);
  }

  return new Response("ok");
}
```

`verifyResendWebhook` takes the `whsec_` secret as Resend shows it, or an array of secrets while you rotate keys, and rejects timestamps more than 300 seconds old. `normalizeWebhookEvent` maps `email.delivered` to `delivered`, `email.bounced` to `bounced`, and `email.complained` to `complained`, and sets `providerMessageId` from `data.email_id`. `deliveryId` comes from the payload `id` or the `svix-id` header, so it works as the dedupe key. The `Set` here lives in memory; with more than one server process, keep processed IDs in a shared store.

### Test without a network

`@opencoredev/email-sdk/testing` exports a `memoryAdapter` that records messages instead of sending them. [Test email behavior](/docs/guides/test-email-behavior) covers failure cases too:

`email.test.ts`:

```ts
import { expect, test } from "bun:test";

import { createEmailClient } from "@opencoredev/email-sdk";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";

test("sends the invoice email", async () => {
  const memory = memoryAdapter();
  const email = createEmailClient({ adapters: [memory] });

  await email.send({ from: "billing@acme.com", to: "ada@example.com", subject: "Your invoice", text: "Attached." });

  expect(memory.raw?.sent).toHaveLength(1);
  expect(memory.raw?.sent[0]?.message.subject).toBe("Your invoice");
});
```

Point production at `resend(...)` and tests at `memoryAdapter()`, and the code between them doesn't change.

### Check the setup from the CLI

```bash
RESEND_API_KEY="re_..." npx --package @opencoredev/email-sdk email-sdk doctor --adapter resend
```

The [adapter reference](/docs/adapters/resend#verify-from-the-cli) shows a dry-run send as well.

## When to use Resend's own SDK

Resend publishes an official Node.js SDK, [`resend`](https://github.com/resend/resend-node), and recommends it for most projects. It covers the whole API: domains, API keys, contacts, broadcasts, templates, receiving, and React Email rendering through its `react` option. Email SDK covers sending and webhook verification, with the same message shape across 27 adapters. Use Resend's SDK or raw `fetch` for account management and Resend-only features. Use Email SDK when you want send code that keeps working if you add a fallback provider or switch providers later.

All code on this page was typechecked against `@opencoredev/email-sdk` 3.0.1, and the Email SDK examples ran against a local stand-in for the Resend API. No real email was sent.

## Related

- [Resend adapter reference](/docs/adapters/resend): every adapter option, capability, and CLI check.
- [Retries and fallback](/docs/concepts/fallbacks-and-retries): when a failed send moves to the next provider.
- [Resend vs Postmark](/compare/resend-vs-postmark): field support side by side for the fallback pair used here.
- [Resend vs SendGrid](/compare/resend-vs-sendgrid) and [Resend vs Mailgun](/compare/resend-vs-mailgun): other providers next to Resend.
- [Mailgun API guide](/blog/mailgun-api-nodejs-typescript): the same walkthrough for Mailgun's multipart API.
