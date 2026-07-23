# Email SDK v1: A Safer TypeScript API for Transactional Email

Switching transactional email providers looks like an import change. The difficult part is preserving behavior when provider capabilities, failures, and delivery certainty do not match.

Email SDK v1 is now available as [`@opencoredev/email-sdk`](https://www.npmjs.com/package/@opencoredev/email-sdk). It provides one server-side TypeScript API across 23 adapters, but the adapter count is only the visible part of the release. The deeper work in v1 is making transactional email behavior explicit: which route will send, which fields it supports, when a failure is safe to retry, and when a fallback could create a duplicate.

![A single envelope moving through a modular routing switchboard, with an amber safety gate stopping an uncertain duplicate path.](/blog/email-sdk-v1/routing-editorial.webp)

That matters because an email pipeline is a distributed system. Your application, the network, an adapter, and a provider can disagree about what happened. A good abstraction cannot erase that uncertainty. It has to expose it without making every application rebuild the same routing machinery.

## The provider API is not the whole boundary

Most provider integrations begin with a tiny wrapper:

```ts
await provider.send({
  from,
  to,
  subject,
  html,
});
```

That works until the application needs attachments, CC and BCC, custom headers, tags, metadata, scheduling, personalization, retries, fallback, idempotency, testing, or observability. Each provider names and supports those concepts differently. A generic wrapper can make the method names uniform while still losing behavior at the edge.

Email SDK v1 treats the boundary as three separate problems:

1. **Normalize the message.** The application uses one `EmailMessage` shape.
2. **Validate the selected route.** The SDK checks common rules and the adapter's declared capabilities before dispatch.
3. **Preserve delivery semantics.** Errors carry enough information for retry and fallback policy to distinguish a proven non-send from an uncertain outcome.

![A normalized EmailMessage passing through common and capability validation before routing to one of 23 adapters.](/blog/email-sdk-v1/adapter-pipeline.svg)

The result is still a small quickstart:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
});

const result = await email.send({
  from: "Acme <hello@acme.com>",
  to: "ada@example.com",
  subject: "Welcome",
  text: "Your account is ready.",
});

console.log(result.adapter, result.id);
```

The difference appears when the pipeline becomes real.

## One message shape, without pretending every provider is identical

A normalized API is useful only if it does not silently discard data. In v1, adapters declare support for fields such as attachments, headers, tags, metadata, scheduling, and personalization. Validation runs before the adapter sends.

If an SMTP route receives provider-specific tags or metadata, for example, it rejects the message instead of quietly dropping those fields. If an adapter cannot schedule natively, it rejects `sendAt` instead of pretending the SDK queued the message. The [field-support matrix](https://email-sdk.dev/docs/adapters/field-support) documents the differences across adapters.

```ts
await email.send(
  {
    from: "Acme <hello@acme.com>",
    to: [{ email: "ada@example.com", name: "Ada" }],
    replyTo: "support@acme.com",
    subject: "Receipt",
    html: "<p>Thanks for your order.</p>",
    text: "Thanks for your order.",
    headers: [{ name: "X-App", value: "acme" }],
    tags: [{ name: "kind", value: "receipt" }],
    metadata: { userId: "user_123" },
    attachments: [
      {
        filename: "receipt.txt",
        content: "Order #123",
        contentType: "text/plain",
      },
    ],
  },
  {
    idempotencyKey: "receipt:user_123:order_123",
    metadata: { job: "order-receipt" },
  },
);
```

The 23 adapter entry points are separate package exports, so an application imports only the integrations it uses. Routes keep literal names through `send`, `validate`, `adapter`, and `withAdapter`, which means TypeScript can reject a misspelled route before production.

Those routes cover provider APIs such as Resend, Postmark, SendGrid, AWS SES, Mailgun, Brevo, Mailchimp Transactional, Loops, and newer independent providers, plus a built-in SMTP transport. SMTP does not pull Nodemailer into the dependency graph. It uses the same message validation and routing contract as the API-backed adapters, while clearly rejecting fields that SMTP cannot represent. The adapter boundary also stays public, so a team can implement a private transport or publish a community adapter without forking the client.

The point is not to make providers interchangeable in every situation. They are not. It is to centralize the differences, validate them before dispatch, and let the application choose routes with accurate information.

## The dangerous fallback case is a successful request with a missing response

Retries are usually described as a response to failure. Email delivery has a more difficult state: **the request may have succeeded even though the caller observed a timeout**.

Consider this sequence:

1. Your application dispatches a request to the primary provider.
2. The provider accepts the email.
3. The response is lost or the connection times out.
4. Your code sees an error and tries the backup provider.
5. The recipient receives the same transactional email twice.

For a password reset or sign-in code, the duplicate is confusing. For a receipt, invoice, or account alert, it can look like the underlying action happened twice.

Email SDK v1 classifies adapter failures with a delivery value:

- `not_sent` means the adapter can prove the provider did not accept the message.
- `unknown` means dispatch may have started, so delivery cannot be ruled out.

![A provider request whose response is lost, causing Email SDK v1 to stop fallback when delivery is unknown.](/blog/email-sdk-v1/delivery-certainty.svg)

Fallback continues for a proven `not_sent` failure. It stops for `unknown` by default:

```ts
const email = createEmailClient({
  adapters: [primary, backup],
  retry: { maxAttempts: 3 },
  fallback: {
    adapters: ["backup"],
    onUnknownDelivery: "stop",
  },
});
```

An application can explicitly set `onUnknownDelivery: "continue"` when duplicates are acceptable or a provider offers stronger idempotency guarantees. The important part is that the risky behavior is a named policy rather than an accidental consequence of a catch block.

The SDK does not claim exactly-once delivery across providers. No client library can prove that without cooperation from the remote systems. V1 instead makes uncertainty visible, supports idempotency keys where adapters can use them, and leaves durable workflow state with the application.

## Retries stay inside one adapter before fallback changes routes

V1 separates two decisions that are often collapsed:

- **Retry:** try the same adapter again according to `maxAttempts`, delay, and `shouldRetry`.
- **Fallback:** move to another adapter only after the current route reaches a terminal failure and policy allows the transition.

```ts
await email.send(message, {
  adapter: "primary",
  retry: { maxAttempts: 1 },
  fallback: { adapters: ["backup"] },
  idempotencyKey: "receipt:order_123",
});
```

Per-send retry and fallback objects replace the client defaults. An `AbortSignal` stops active work, backoff, and every later route. If all routes fail, `EmailRouteError.failures` preserves the attempted adapter order and typed adapter errors, so logs and user-facing decisions do not have to parse provider strings.

## Three sending methods replace one overloaded batch API

V1 gives each execution model a separate method:

- `send()` sends one message and returns one result.
- `sendMany()` runs independent sends sequentially, preserves input order, and returns one settled result per item.
- `sendPersonalized()` renders recipient variables against one shared message template.

![The send, sendMany, and sendPersonalized methods mapped to single, ordered batch, and recipient-specific delivery.](/blog/email-sdk-v1/sending-modes.svg)

```ts
await email.sendMany([
  {
    message: welcomeMessage,
    options: { idempotencyKey: "welcome:ada" },
  },
  {
    message: receiptMessage,
    options: { idempotencyKey: "receipt:linus:123" },
  },
]);

await email.sendPersonalized(
  {
    message: {
      from: "Acme <hello@acme.com>",
      subject: "Hi %recipient.name%",
      text: "Welcome, %recipient.name%.",
    },
    recipients: [
      { to: "ada@example.com", variables: { name: "Ada" } },
      { to: "linus@example.com", variables: { name: "Linus" } },
    ],
  },
  { idempotencyKey: "onboarding:2026-07" },
);
```

`sendMany()` is intentionally sequential in v1. That makes ordering and settled results predictable instead of hiding concurrency and rate-limit behavior inside the client. Applications that need a durable, concurrent queue should keep that orchestration in their job system or use the Convex component.

## Plugins extend the pipeline without changing the core message API

The v1 plugin surface can register adapters, add middleware, compose lifecycle hooks, and extend the returned client. Built-in plugins cover common cross-cutting concerns:

- defaults for headers, tags, metadata, reply-to, and idempotency prefixes
- dynamic adapter routing
- whole-send timeouts
- redacted observability events
- in-memory capture for tests

```ts
import { defaultsPlugin } from "@opencoredev/email-sdk/plugins/defaults";
import { observabilityPlugin } from "@opencoredev/email-sdk/plugins/observability";
import { timeoutPlugin } from "@opencoredev/email-sdk/plugins/timeout";

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
  plugins: [
    defaultsPlugin({
      headers: [{ name: "X-App", value: "acme" }],
      idempotencyKeyPrefix: "acme:",
    }),
    timeoutPlugin({ timeoutMs: 10_000 }),
    observabilityPlugin({
      log(event) {
        console.log(event.type, event.adapter);
      },
    }),
  ],
});
```

Hooks and observability are designed around lifecycle metadata, not message content or secrets. Email SDK's anonymous telemetry follows the same boundary: it records operational shape such as adapter names, commands, timing, and error codes, while excluding subjects, addresses, bodies, headers, attachments, keys, and raw provider responses. It can be disabled with `EMAIL_SDK_TELEMETRY=0`, `DO_NOT_TRACK=1`, or `telemetry: false`.

## Testing and the CLI use the same validation path

A production email pipeline should be testable without a provider account. The `/testing` entry point includes memory and failing adapters, plus capture utilities for asserting route attempts, retries, and lifecycle events.

The package also installs an `email-sdk` CLI:

```bash
email-sdk adapters
RESEND_API_KEY=re_xxx email-sdk doctor --adapter resend
email-sdk send \
  --adapter resend \
  --from "Acme <hello@acme.com>" \
  --to ada@example.com \
  --subject "Welcome" \
  --text "Your account is ready." \
  --dry-run
```

`send --dry-run` constructs the adapter, validates the normalized message, and prints the plan without calling the adapter's send method. This makes local setup checks use the same contract as application sends.

## The same client now connects to templates, AI tools, and durable Convex workflows

V1 includes optional integrations around the core client:

- [`@opencoredev/email-sdk/react`](https://email-sdk.dev/docs/ui) renders React email templates and includes email-safe, shadcn-themed building blocks that use inline styles.
- [`@opencoredev/email-sdk/ai`](https://email-sdk.dev/docs/integrations/ai-sdk) creates a narrow, approval-gated Vercel AI SDK tool. The application binds the sender, and the model can request only recipients, subject, text, and HTML.
- [`@opencoredev/convex-email`](https://email-sdk.dev/docs/integrations/convex) adds durable queueing, retries, fallback routes, reactive status, provider webhooks, recovery, and a safe test mode for Convex applications.

These integrations do not expand the model-visible or browser-visible secret boundary. Provider credentials remain in the server environment, and sending policy remains application-owned.

## Migrating from v0

V1 uses **adapter** terminology consistently across the root API. The largest migration changes are mechanical:

- `providers` becomes `adapters`
- `defaultProvider` becomes `defaultAdapter`
- `provider` send options become `adapter`
- `sendBatch()` becomes `sendMany()`
- `recipientVariables` moves to `sendPersonalized()`
- `retry.retries` becomes `retry.maxAttempts`
- fallback becomes an explicit object with `adapters` and `onUnknownDelivery`
- `idempotencyKey` moves into send options

The [v0 to v1 migration guide](https://email-sdk.dev/docs/guides/migrate/v0-to-v1) includes before-and-after examples for the full breaking-change surface. The compatibility entry point can help stage a migration, but new code should target the adapter-first v1 API directly.

## Install v1

```bash
bun add @opencoredev/email-sdk
```

Start with the [quickstart](https://email-sdk.dev/docs/getting-started/quickstart), choose an adapter from the [adapter directory](https://email-sdk.dev/docs/adapters), and read the [production send pipeline guide](https://email-sdk.dev/docs/guides/production-send-pipeline) before enabling retries or fallback for critical messages.

Email SDK is open source under AGPL-3.0. The source, issues, and contribution guides are available on [GitHub](https://github.com/opencoredev/email-sdk). Companies that want an official adapter can open an issue or contact the project.

This release was made possible by the project's sponsors: [Resend](https://go.resend.com/email-sdk), [Sequenzy](https://www.sequenzy.com/?ref=emailsdk), [JetEmail](https://jetemail.com), [Primitive](https://www.primitive.dev), [Lettermint](https://lettermint.co/?ref=emailsdk), [Instatus](https://instatus.com/?ref=emailsdk), and [Notra](https://usenotra.com).

The goal for v1 is simple: make a transactional email pipeline easier to change **without hiding the decisions that determine whether it is safe**.
