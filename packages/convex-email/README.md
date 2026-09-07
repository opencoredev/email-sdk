# Convex Email Ops

Provider-portable transactional email operations for Convex. `@opencoredev/convex-email` wraps `@opencoredev/email-sdk` as a Convex Component so apps get durable queued sends, retries, fallback adapters, idempotency, webhook ingestion, test mode, attempted-adapter history, and reactive delivery state.

```bash
bun add @opencoredev/convex-email @opencoredev/email-sdk
```

## When To Use This

- Queue email from Convex mutations without calling providers inline.
- Store delivery status and event history in Convex tables.
- Route through Resend, Postmark, SendGrid, SES, SMTP, Mailgun, Brevo, and other Email SDK adapters.
- Use fallback adapters when the primary route fails.
- Deduplicate repeated sends with an idempotency key.
- Capture provider webhooks as delivery events and track delivered/bounced/complained state per email.
- Redirect real messages to sandbox recipients in test mode.

Use the official `@convex-dev/resend` component for a Resend-only app that wants the official Resend integration. Use Convex Email Ops when provider portability, fallback routing, status history, or test-safe multi-provider operations matter.

## Add The Component

```ts
// convex/convex.config.ts
import { defineApp } from "convex/server";
import { v } from "convex/values";
import convexEmail from "@opencoredev/convex-email/convex.config.js";

const app = defineApp({
  env: {
    RESEND_API_KEY: v.optional(v.string()),
    POSTMARK_SERVER_TOKEN: v.optional(v.string()),
    SENDGRID_API_KEY: v.optional(v.string()),
    SMTP_HOST: v.optional(v.string()),
    SMTP_PORT: v.optional(v.string()),
    SMTP_USER: v.optional(v.string()),
    SMTP_PASS: v.optional(v.string()),
  },
});

app.use(convexEmail, {
  env: {
    RESEND_API_KEY: app.env.RESEND_API_KEY,
    POSTMARK_SERVER_TOKEN: app.env.POSTMARK_SERVER_TOKEN,
    SENDGRID_API_KEY: app.env.SENDGRID_API_KEY,
    SMTP_HOST: app.env.SMTP_HOST,
    SMTP_PORT: app.env.SMTP_PORT,
    SMTP_USER: app.env.SMTP_USER,
    SMTP_PASS: app.env.SMTP_PASS,
  },
});

export default app;
```

Set provider secrets with Convex environment variables, then map them into the component:

```bash
bun x convex env set RESEND_API_KEY re_xxx
```

## Create A Client

```ts
// convex/email.ts
import { components } from "./_generated/api";
import { ConvexEmail } from "@opencoredev/convex-email";

export const email = new ConvexEmail(components.convexEmail, {
  adapters: [
    {
      kind: "resend",
    },
    {
      kind: "smtp",
      name: "backup-smtp",
    },
  ],
  defaultAdapter: "resend",
  fallbackAdapters: ["backup-smtp"],
  maxAttempts: 3,
});
```

## Send From A Mutation

```ts
// convex/users.ts
import { mutation } from "./_generated/server";
import { email } from "./email";

export const sendWelcomeEmail = mutation({
  args: {},
  handler: async (ctx) => {
    return await email.send(ctx, {
      from: "Acme <hello@acme.com>",
      to: "ada@example.com",
      subject: "Welcome",
      text: "Your account is ready.",
      idempotencyKey: "welcome:ada@example.com",
    });
  },
});
```

`email.send()` returns the Convex document id for the queued email. Query `email.status(ctx, { emailId })` and `email.listEvents(ctx, { emailId })` from app functions when you need delivery state, attempted adapters, provider message ids, or errors. Once webhooks are wired up, the stored email also carries a `deliveryStatus` (`delivered`, `bounced`, or `complained`) and a `deliveredAt` timestamp. The returns are typed: `status` resolves to `ConvexEmailDoc | null` and `listEvents` to `ConvexEmailEventDoc[]`, both exported from the package root along with `ConvexEmailDeliveryStatus` and `ConvexEmailProviderFailure`.

## Provider Coverage

Every built-in Email SDK adapter is configurable, plus the in-memory adapter for tests:

```txt
memory
brevo
cloudflare
iterable
jetemail
lettermint
lettr
loops
mailchimp
mailersend
mailgun
mailpace
mailtrap
plunk
postmark
primitive
resend
scaleway
sendgrid
sequenzy
ses
smtp
sparkpost
unosend
zeptomail
```

Adapter configuration is data, not code. `src/shared/adapters.ts` declares each adapter's options, and the wire validators, config types, declared component environment, and runtime option resolution are all derived from it. A new Email SDK adapter becomes available here through one registry entry plus one factory line, and the build fails if its credentials are not declared in the component environment.

Default environment variables:

```txt
AWS_ACCESS_KEY_ID
AWS_REGION
AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN
BREVO_API_KEY
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
ITERABLE_API_KEY
ITERABLE_CAMPAIGN_ID
JETEMAIL_API_KEY
LETTERMINT_API_TOKEN
LETTERMINT_ROUTE
LETTR_API_KEY
LOOPS_API_KEY
LOOPS_TRANSACTIONAL_ID
MAILCHIMP_API_KEY
MAILERSEND_API_KEY
MAILGUN_API_KEY
MAILGUN_DOMAIN
MAILPACE_API_KEY
MAILTRAP_API_KEY
PLUNK_API_KEY
POSTMARK_SERVER_TOKEN
PRIMITIVE_API_KEY
RESEND_API_KEY
SCALEWAY_PROJECT_ID
SCALEWAY_REGION
SCALEWAY_SECRET_KEY
SENDGRID_API_KEY
SEQUENZY_API_KEY
SMTP_HOST
SMTP_PASS
SMTP_PORT
SMTP_SECURE
SMTP_USER
SPARKPOST_API_KEY
UNOSEND_API_KEY
ZEPTOMAIL_TOKEN
```

Credentials are always read from the environment, so adapter config never stores a secret. Fields that identify a resource rather than authenticate one — `route`, `domain`, `accountId`, `campaignId`, `transactionalId`, `projectId`, `region`, `host`, `port`, `secure`, `baseUrl` — can be written inline instead:

```ts
export const email = new ConvexEmail(components.convexEmail, {
  adapters: [
    { kind: "lettermint", route: "transactional" },
    { kind: "lettermint", name: "lettermint-broadcast", route: "broadcast" },
  ],
  defaultAdapter: "lettermint",
});
```

A Convex component only receives the environment variables its own contract declares, so the component reads exactly the names listed above. To feed an adapter a differently named secret, map it onto the declared name when you mount the component:

```ts
app.use(convexEmail, {
  env: { LETTERMINT_API_TOKEN: app.env.LETTERMINT_BROADCAST_TOKEN },
});
```

Environment-backed fields also accept an `Env` suffix — `apiKeyEnv`, `apiTokenEnv`, `tokenEnv`, `serverTokenEnv`, `domainEnv`, `accountIdEnv`, `projectIdEnv`, `regionEnv`, and so on — which repoints a field at a different *declared* variable. Naming a variable the component does not declare throws an explicit error instead of silently resolving to nothing once deployed.

Non-serializable Email SDK options such as custom `fetch`, SMTP `tls`, and function-valued Iterable `dataFields` are intentionally not exposed in component config.

## Webhooks

Register webhook routes from `convex/http.ts`. Verify signatures or shared secrets in the app-mounted route before forwarding to the component.

```ts
import { httpRouter } from "convex/server";
import { email } from "./email";

const http = httpRouter();
email.registerRoutes(http, {
  pathPrefix: "/email",
  providers: ["resend"],
  verify: ({ headers }) => {
    return headers["x-webhook-secret"] === process.env.EMAIL_WEBHOOK_SECRET;
  },
});

export default http;
```

This creates `POST /email/webhooks/resend` and records duplicate deliveries idempotently.
Omitting `verify` is only suitable for local development; public routes should always verify provider signatures or a shared secret.

When a webhook matches a stored email by provider message id, the component records a `webhook` event and normalizes the provider's event name onto the email's `deliveryStatus`: delivered, bounced, or complained. Only permanent failures count as `bounced`: Mailgun `failed` events map to `bounced` only when `severity` is `"permanent"`, and Postmark `Bounce` records only when `Type` is a permanent class (`HardBounce`, `BadEmailAddress`, `ManuallyDeactivated`). Soft/temporary failures stay in the event history without touching `deliveryStatus`, because the provider retries them and the message may still deliver.

Bounces and complaints are sticky against `delivered`: a delivery event that arrives late (or is retried out of order) never hides a recorded bounce or complaint. Between `bounced` and `complained` themselves, the most recent webhook wins. Other events, such as opens and clicks, are kept in the event history without changing `deliveryStatus`.

## Test Mode

Use `setConfig` to redirect sends while keeping the queue and provider flow intact:

```ts
await email.setConfig(ctx, {
  testMode: true,
  sandboxTo: ["dev@example.com"],
});
```

If `testMode` is enabled without `sandboxTo`, sends fail before enqueueing so real recipients are not contacted by mistake.

`setConfig` replaces the whole stored config, so pass every field you want to keep. Omitting a field clears it; there is no partial merge.

For local or CI tests, use the memory adapter:

```ts
export const email = new ConvexEmail(components.convexEmail, {
  adapters: [{ kind: "memory" }],
  defaultAdapter: "memory",
});
```

The package exports Convex test helpers from `@opencoredev/convex-email/test`.

`exposeApi()` intentionally omits `setConfig` and `getConfig` by default. Pass `{ includeConfigApi: true }` only from a module protected by your own server-side auth checks.

## Cleanup

The component ships a five-minute cron sweep for missed queue work, stale `processing` recovery, and cleanup.
Set `cleanupAfterDays` to prune expired terminal email rows, delivery records, and event history during that sweep.
Stale `processing` sends are only auto-retried when the email has an `idempotencyKey`; without one, the component fails closed because the provider request may already have been delivered.

```ts
await email.setConfig(ctx, {
  cleanupAfterDays: 30,
});
```

## Scope

Convex Email Ops is not a campaign builder, contact database, template editor, hosted analytics product, or inbound email processor. It keeps the operational pieces apps usually rebuild: queueing, retries, fallback routing, idempotency, webhook records, attempted-adapter history, and queryable status.

`sendBatch` accepts at most 100 messages per mutation. Split larger batches in your app so Convex mutation limits stay predictable.

URL attachments are fetched server-side only from public HTTPS hosts. Localhost, internal hostnames, IP literal hosts, and URLs with credentials are rejected; fetch the content in your app first if you need a custom attachment source.
