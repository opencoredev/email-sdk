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
import convexEmail from "@opencoredev/convex-email/convex.config.js";

const app = defineApp();
app.use(convexEmail);

export default app;
```

## Export The Sender Action

Convex rejects `"use node"` modules inside components, so the component runs entirely in Convex's default runtime: it owns the queue, retries, cleanup, and webhook records. Provider requests (every HTTP adapter, SMTP, and URL attachment fetching) run in an action your app exports from its own `"use node"` file:

```ts
// convex/emailSender.ts
"use node";

import { emailSender } from "@opencoredev/convex-email/node";
import { components } from "./_generated/api";

export const send = emailSender(components.convexEmail);
```

The component schedules this internal action once per attempt through a function handle, and the action records each provider attempt and its result back in the component. Each component instance uses one sender: the most recent one any `ConvexEmail` client passed, which also picks up a renamed sender action for emails already queued. To run two differently configured senders, mount the component twice with `app.use(convexEmail, { name: "..." })`. Pass `emailSender(components.convexEmail, { telemetry: false })` to turn off Email SDK telemetry for these sends; otherwise the SDK follows `EMAIL_SDK_TELEMETRY` and `DO_NOT_TRACK` in the deployment environment.

Set provider secrets as Convex environment variables. The sender action reads them from the deployment environment:

```bash
bun x convex env set RESEND_API_KEY re_xxx
```

## Create A Client

```ts
// convex/email.ts
import { components, internal } from "./_generated/api";
import { ConvexEmail } from "@opencoredev/convex-email";

export const email: ConvexEmail = new ConvexEmail(components.convexEmail, {
  sender: internal.emailSender.send,
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

Keep the `: ConvexEmail` annotation: `internal` is typed from every module in `convex/`, including this one, so without it TypeScript reports that `email` implicitly has type `any`.

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
helo
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
sendheron
sequenzy
ses
smtp
sparkpost
unosend
zeptomail
```

Adapter configuration is data, not code. `src/shared/adapters.ts` declares each adapter's options, and the wire validators, config types, and runtime option resolution are all derived from it. A new Email SDK adapter becomes available here through one registry entry plus one factory line.

Default environment variables:

```txt
AWS_ACCESS_KEY_ID
AWS_REGION
AWS_SECRET_ACCESS_KEY
AWS_SESSION_TOKEN
BREVO_API_KEY
CLOUDFLARE_ACCOUNT_ID
CLOUDFLARE_API_TOKEN
HELO_API_KEY
HELO_CHANNEL_ID
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
SENDHERON_API_KEY
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
export const email: ConvexEmail = new ConvexEmail(components.convexEmail, {
  sender: internal.emailSender.send,
  adapters: [
    { kind: "lettermint", route: "transactional" },
    { kind: "lettermint", name: "lettermint-broadcast", route: "broadcast" },
  ],
  defaultAdapter: "lettermint",
});
```

The sender action reads only the names listed above. Environment-backed fields also accept an `Env` suffix — `apiKeyEnv`, `apiTokenEnv`, `tokenEnv`, `serverTokenEnv`, `domainEnv`, `accountIdEnv`, `projectIdEnv`, `regionEnv`, and so on — which repoints a field at another variable from that list. Naming any other variable throws an explicit error: adapter config can come from callers of `exposeApi()`, and the sender action can read every deployment secret, so an override must not be able to send an unrelated secret to a provider. To use a differently named secret, set it under the default name.

Non-serializable Email SDK options such as custom `fetch`, SMTP `tls`, and function-valued Iterable `dataFields` are intentionally not exposed in component config.

## Webhooks

Register webhook routes from `convex/http.ts`. `registerRoutes()` requires a `verify` function and throws without one. Each provider route runs `verify` against the raw request before anything reaches the component, and a failed check returns `401`.

```ts
import { httpRouter } from "convex/server";
import {
  mailgunWebhookVerifier,
  postmarkBasicAuthVerifier,
  resendWebhookVerifier,
  verifyByProvider,
} from "@opencoredev/convex-email";
import { email } from "./email";

const http = httpRouter();
email.registerRoutes(http, {
  pathPrefix: "/email",
  providers: ["resend", "mailgun", "postmark"],
  verify: verifyByProvider({
    resend: resendWebhookVerifier({ secret: process.env.RESEND_WEBHOOK_SECRET! }),
    mailgun: mailgunWebhookVerifier({ secret: process.env.MAILGUN_WEBHOOK_SIGNING_KEY! }),
    postmark: postmarkBasicAuthVerifier({
      username: process.env.POSTMARK_WEBHOOK_USER!,
      password: process.env.POSTMARK_WEBHOOK_PASSWORD!,
    }),
  }),
});

export default http;
```

This creates `POST /email/webhooks/resend`, `/email/webhooks/mailgun`, and `/email/webhooks/postmark`, and records duplicate deliveries idempotently.

The built-in verifiers use `@opencoredev/email-sdk/webhooks`:

- `resendWebhookVerifier({ secret, toleranceSeconds? })` checks the Svix signature Resend sends.
- `mailgunWebhookVerifier({ secret, toleranceSeconds?, signatureField? })` checks Mailgun's HMAC signature with your webhook signing key.
- `postmarkBasicAuthVerifier({ username, password })` checks the HTTP basic auth credentials you configure on the Postmark webhook URL.
- `verifyByProvider({ ... })` dispatches to one verifier per provider and rejects providers it has no verifier for.

Each helper rejects requests for a different provider, so a Resend verifier never accepts a request on the Mailgun route. For any other provider, pass your own function. It receives `{ provider, request, body, headers }` and returns a boolean or a promise of one:

```ts
verify: ({ headers }) => headers["x-webhook-secret"] === process.env.EMAIL_WEBHOOK_SECRET,
```

For local development only, `unsafeAllowUnverifiedWebhooks: true` registers the routes without verification and logs a warning. Never deploy that configuration.

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
export const email: ConvexEmail = new ConvexEmail(components.convexEmail, {
  sender: internal.emailSender.send,
  adapters: [{ kind: "memory" }],
  defaultAdapter: "memory",
});
```

The package exports Convex test helpers from `@opencoredev/convex-email/test`. `registerConvexEmail(t)` registers the component's modules; your `convex/emailSender.ts` is one of your app's modules, so `convex-test` runs it like any other action.

`exposeApi()` requires an authenticated Convex identity by default and stamps its `subject` as the email owner. Public status, events, cancellation, and retries only work for that owner; records queued through server-only `email.send()` are not exposed. Pass `authorize` to use a tenant id or operation-specific policy instead. It returns an owner id, or `null` to deny the request:

```ts
export const { send, status, listEvents, cancel, retry } = email.exposeApi({
  authorize: async (ctx, operation) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity || (operation === "send" && !identity.tokenIdentifier.startsWith("my-app|"))) {
      return null;
    }
    return identity.subject;
  },
});
```

Public `send` and `sendBatch` do not accept `adapters`. The sender action reads credentials from the whole deployment environment, so a caller who could set `apiKeyEnv` and `baseUrl` could send a secret to their own server. Public sends use the adapters configured on the `ConvexEmail` client, and callers can still pick one of them by name with `adapter` and `fallbackAdapters`.

This is intentionally a security boundary, not recipient policy: use explicit app wrappers when sending must be restricted to particular recipients or roles. `setConfig` and `getConfig` stay excluded by default. If they are needed, pass both `includeConfigApi: true` and an explicit `authorizeConfig` admin check.

### Migrating `exposeApi()` in v3

Before v3, this exposed unauthenticated operations:

```ts
export const emailApi = email.exposeApi();
```

The same call now requires your app to configure Convex authentication; authenticated callers are automatically scoped to their identity `subject`:

```ts
export const emailApi = email.exposeApi();
```

Use the `authorize` example above when ownership should be a tenant or when individual operations need different access rules. Existing email rows have no trusted public owner, so records queued before this upgrade remain unavailable through `exposeApi()` rather than being guessed or backfilled. Server-side `email.status()`, `email.listEvents()`, and other application wrappers remain available for authorized operational migrations.

## Upgrading From 5.x

Versions 5.0.0 and earlier shipped `"use node"` modules inside the component, which the Convex CLI and backend reject, so no deployment could run them. Version 6 moves provider requests into the app's sender action:

1. Drop the `env` option from `app.use(convexEmail, { env })`, plus any `defineApp({ env })` entries you added only for the component. Set each secret with `convex env set` under its default name.
2. Add `convex/emailSender.ts` as shown above.
3. Pass `sender: internal.emailSender.send` to `new ConvexEmail(...)` and annotate the export as `ConvexEmail`.

```ts
// Before (5.x)
export const email = new ConvexEmail(components.convexEmail, {
  adapters: [{ kind: "resend" }],
});

// After (6.x)
export const email: ConvexEmail = new ConvexEmail(components.convexEmail, {
  sender: internal.emailSender.send,
  adapters: [{ kind: "resend" }],
});
```

`ConvexEmail` now requires its options argument, because `sender` is required. `exposeApi()` send and batch functions reject an `adapters` field: configure adapters on the client instead, and let callers choose among them by name.

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

URL attachments are fetched server-side, by the sender action, only from public HTTPS hosts. Localhost, internal hostnames, IP literal hosts, and URLs with credentials are rejected. The sender resolves the hostname before every request, refuses the fetch if any resolved address is private, loopback, link-local, or otherwise non-public, and connects only to the addresses it checked, so DNS rebinding cannot swap in an internal target. Redirects are followed manually, at most 3 hops, and each hop goes through the same checks. Downloads are capped at 10 MiB. Fetch the content in your app first if you need a custom attachment source.
