# @opencoredev/email-sdk

## 4.0.0

### Major Changes

- e2a2f64: `idempotencyKey` is no longer dropped silently. When any adapter on the route (primary or fallback) reports `capabilities.idempotency: "none"`, `send`, `sendMany` items, `sendPersonalized`, and `validate` now throw `EmailValidationError` before any request, because that adapter cannot deduplicate a retried send. Twenty built-in adapters report `"none"`, including SendGrid, Postmark, SES, Mailgun, and Brevo.

  Behavior change: a send that passed `idempotencyKey` to one of those adapters used to succeed without deduplication and now fails. To keep sending, either remove the key, route to an adapter with native idempotency (Resend, JetEmail, Lettermint, Primitive, SendHeron, Helo) or SMTP, or pass the new send option `idempotency: "best-effort"`:

  ```ts
  // Before: the key was ignored on SendGrid.
  await email.send(message, {
    adapter: "sendgrid",
    idempotencyKey: "receipt:42",
  });

  // After: say that provider deduplication is optional.
  await email.send(message, {
    adapter: "sendgrid",
    idempotencyKey: "receipt:42",
    idempotency: "best-effort",
  });
  ```

  `createEmailTools` from `@opencoredev/email-sdk/ai` and the `@opencoredev/email-sdk/compat` client set a key on every send, so they pass `idempotency: "best-effort"` and keep working on every adapter.

  `client.adapters` and the `adapters` map in plugin contexts are now frozen read-only views at runtime instead of raw `Map` instances. They no longer expose `set`, `delete`, or `clear`, and `client.adapters instanceof Map` is now `false`. Reads, iteration (`forEach` with `thisArg`, `entries`, `keys`, `values`), and adapters added through `extendClient` keep working as before:

  ```ts
  // Before: casting client.adapters to Map worked at runtime.
  const copy = client.adapters instanceof Map ? client.adapters : new Map();

  // After: copy into a new Map if you need a mutable snapshot.
  const copy = new Map(client.adapters);
  ```

### Minor Changes

- e2a2f64: `sendMany` takes a `concurrency` option: `email.sendMany(items, { concurrency: 5 })` sends up to five items at once. It defaults to `1`, so existing batches still send one at a time. Results always come back in input order with the same settled `{ ok, index, result | error }` shape. `concurrency` must be a positive integer and is not passed to each send. The new `EmailSendManyOptions` type is exported from the package root.
- e2a2f64: `email-sdk send` gains routing and machine-readable output flags:

  - `--fallback name,name` tries more adapters, in order, after the primary definitely did not send. Fallback adapters read their configuration from environment variables only; credential flags such as `--api-key` stay with the primary.
  - `--max-attempts n` sets attempts per adapter, including the first.
  - `--json` prints `{ ok: true, result }` on success and `{ ok: false, error }` on failure, both on stdout, with route failures listed per adapter. Without `--json`, output is unchanged.

  `--dry-run` validates the message against every adapter on the route and adds `fallback` and `maxAttempts` to the plan when they are set.

- 44548f0: Add experimental durable email workflows at `@opencoredev/email-sdk/workflows`. Define drips and onboarding sequences as step functions with `ctx.send`, `ctx.sleep`, `ctx.waitForEvent` (with timeouts), and `ctx.step`; branch with plain TypeScript; cancel runs by id, by `cancelOn` events such as `unsubscribed`, or through an `isSuppressed` check. Each send carries a stable idempotency key, `wf_` plus the hex SHA-256 of the JSON-encoded `[runId, step]` pair (67 characters, from `workflowIdempotencyKey`), completed steps are journaled so replays never repeat them, failed steps retry on timers, and workers claim runs with revision-checked leases so several processes can share one store. A worker trusts its lease only until the time it sent the claim or renewal plus `leaseDuration`, minus the new `leaseSafetyMargin` option (default a tenth of the lease, at most 30s), so a slow store reply never lets a step or send start after another worker may have taken the run over. A late reply only delays the next effect until a fresh renewal returns in time; a step result the store's revision check accepts is always kept. Storage and timers plug in through small `WorkflowStore` and `WorkflowScheduler` interfaces (lease-expiry timers carry an `owner` to pass back as `engine.resume(runId, { owner })`), with in-memory versions and a manual clock for tests. While a `ctx.step` callback is in flight, any other `ctx` call on that run, from inside the callback or beside the pending step, fails the run at once with `invalid_definition`, so a nested call can never wait on its own step. `WorkflowEmailSender.send` gets the run id and step name as an optional third argument (`WorkflowSendContext`), which an `EmailClient` ignores. The package root does not import the new entry, so the main bundle is unchanged.
- 0b6a7fe: Add an experimental `native` send option for provider-specific features. Its keys are adapter names, TypeScript infers the accepted keys and shapes from the client's adapters, and each adapter in a fallback chain receives only its own entry. Resend, Postmark, SendGrid, SES, Mailgun, Brevo, and Loops get typed options for templates, tracking, streams, configuration sets, sandbox and test modes, and more. Resend and Brevo template sends still send the message `subject` as an override; set `useTemplateSubject: true` to keep the template's subject. Most HTTP JSON adapters accept a typed `body`/`headers` passthrough (Mailgun: `fields`) for fields the SDK doesn't model. `sendPersonalized` rejects that passthrough because it can replace the recipients the result reports, and a native request header can't name one the adapter or transport sets itself, such as credentials, `Content-Type`, or SES's SigV4 signing headers. Resend reserves `Idempotency-Key` on every send, so per-send keys always come from the `idempotencyKey` option and each `sendPersonalized` recipient keeps its own key. Telemetry doesn't infer submitted recipients for a send whose `body` or `fields` passthrough may have replaced them. Existing `EmailSendOptions` annotations keep compiling, and sends without `native` are unchanged.
- e2a2f64: `@opencoredev/email-sdk/webhooks` supports SendGrid and SES delivery events:

  - `verifySendGridWebhook({ body, headers, publicKey })` checks a Signed Event Webhook request (ECDSA P-256 over the timestamp header and raw body) and its timestamp. It returns `false` on any bad input, and `publicKey` accepts an array for rotation.
  - `normalizeWebhookEvents({ provider, body })` returns every event in a body. SendGrid batches events per request; the other providers return one. `normalizeWebhookEvent` accepts `"sendgrid"` for a one-event body and `"ses"` for an SNS notification, an EventBridge event, or a bare SES event.
  - SendGrid `delivered`, `spamreport`, and hard `bounce` events map to `delivered`, `complained`, and `bounced`; SES `Delivery`, `Complaint`, and `Permanent` bounces do the same. SendGrid `providerMessageId` matches the id the SendGrid adapter returns, and SES uses `mail.messageId`.

  `WebhookProvider` now includes `"sendgrid"` and `"ses"`. An exhaustive `switch` over it needs the two new cases.

- 44548f0: Add a workflow inspector and CLI. `inspectWorkflow(definition, { input, events, steps })` explores every path a workflow can take without sending anything, forking each timed `waitForEvent` into `received` and `timeout` branches, and returns a JSON graph of rendered emails, delays, event waits, mocked steps, and end states, capped by `maxPaths` and `maxDepth`. `toMermaid` and `formatWorkflowGraph` render it, and `describeRun` turns a stored `WorkflowRun` into a timeline with the current wait and deadline. `email-sdk workflows inspect <module> --export <name> --input <json|@file>` prints the same graph as JSON, Mermaid, or text.

### Patch Changes

- e2a2f64: Harden client and adapter input boundaries: isolate plain `metadata`, `message`, error/response snapshots (`accepted`/`rejected`), and attachment byte snapshots across observational hooks (`afterSend`, `onError`, `onRetry`), middleware, retries, fallbacks, and `sendMany` (note: hooks can no longer share mutable state by mutating plain `metadata` objects; wrap shared state in a custom class instance if shared references are required); cap array snapshot lengths and metadata nesting depth; reject CR/LF characters in header names; bind plugin/hook/retry callables via `Function.prototype.bind`; and validate direct `mailgun`/`sendgrid` `sendPersonalized` inputs before network requests.
- 6b56f95: `native` send options passed through the client (and to SendGrid's and Mailgun's `sendPersonalized`) are now rejected with an `EmailValidationError` (wrapped in `EmailMiddlewareError` when they come from options a `beforeSend` middleware returned) when they contain a cycle, or when the SDK's copy of them goes over a budget of 1,000,000 units (each value, array slot including sparse ones, object key, and native map entry counts as one) or 32 Mi UTF-16 code units of strings and keys. All adapter entries of one send share the budget. Calling an adapter's `send` directly still passes `native` through unchecked, as before. It measures the copied data, not the serialized request size. Before, the snapshot limited only nesting depth, so an object reused across many fields could be copied into far more data than it held before provider validation ran.
- e2a2f64: `defaultsPlugin` headers now yield to a message header with the same name (compared case-insensitively) instead of being sent alongside it. Before, `defaultsPlugin({ headers: [{ name: "X-Tenant", value: "a" }] })` plus a message that set `X-Tenant` failed with "does not support repeated email header names" on the 21 adapters without repeated-header support, and sent both values on the rest. Legacy name-to-value header objects from JavaScript callers now merge too.
- e2a2f64: `@opencoredev/email-sdk/cloudflare` and the other HTTP adapter entry points now bundle for Cloudflare Workers without `nodejs_compat` when called directly (the client's optional telemetry still uses Node built-ins unless `nodejs_compat` is enabled). Attachment encoding uses Web APIs (`btoa`, `TextEncoder`) instead of `Buffer`, and `node:fs/promises` loads only when an attachment is given by `path`. On a runtime without it, a `path` attachment fails with an `EmailValidationError` that says to pass `content` instead. Attachment `content` with `contentEncoding: "base64"` is now decoded strictly: input with wrong padding (`"QUJ="`, `"QQ="`) or non-canonical pad bits (`"QR=="`) throws `EmailValidationError` instead of being silently repaired the way `Buffer.from(value, "base64")` did (whitespace, missing padding, and URL-safe input are still accepted).
- e2a2f64: The Microsoft Graph adapter no longer requests a new OAuth token on every send when the token response has an unusable `expires_in`, such as `0`, a negative number, an empty string, or a non-numeric string. Those now fall back to a one-hour lifetime, like a missing value already did. Numeric strings such as `"3600"` still work.
- e2a2f64: `handleInbound` from `@opencoredev/email-sdk/inbound` caps the request body it reads before verifying the signature. The new `maxBodyBytes` option defaults to `DEFAULT_INBOUND_MAX_BODY_BYTES` (50 MiB). A larger `Content-Length` is refused before reading, and a chunked or mislabeled body is cancelled once it passes the limit, both with the new `InboundError` reason `payload_too_large` (respond 413). `Infinity` disables the limit.
- c77fd08: CLI: `email-sdk send --adapter smtp` with `--user`/`--pass` now requires TLS before authenticating, matching the SDK default. Previously the CLI passed `requireTLS: false` when `--require-tls` was absent, so credentials could be sent over a plaintext connection to a server without STARTTLS. Pass `--allow-insecure-auth` (or `SMTP_ALLOW_INSECURE_AUTH=true`) to keep plaintext AUTH for a trusted local test server.

  The SMTP boolean flags now win over their env vars in both directions (`--allow-insecure-auth=false` overrides `SMTP_ALLOW_INSECURE_AUTH=true`), malformed or empty values fail instead of being read as a bare flag, and leaving `--secure`/`SMTP_SECURE` unset keeps the SDK default of implicit TLS on port 465.

- e2a2f64: The one-time telemetry opt-out notice now prints only when stderr is a terminal. Servers, CI jobs, and test harnesses that assert on stderr no longer get an unsolicited multi-line message from the library. A run that skips the notice does not mark it as shown, so the first interactive run, such as the CLI in a terminal, still prints it. Telemetry itself and its opt-outs (`EMAIL_SDK_TELEMETRY=0`, `DO_NOT_TRACK=1`, `telemetry: false`) are unchanged.
- e2a2f64: Every built-in adapter now reads its credential on each send. SendGrid, Brevo, MailerSend, Cloudflare (REST), Iterable, Loops, MailPace, Plunk, SparkPost, Scaleway, Mailtrap, Unosend, Sequenzy, and ZeptoMail used to copy the key into their request headers when the adapter was created, so a rotated key or a getter on the options object was ignored until the client was rebuilt. They now behave like Resend, Postmark, SES, and the other adapters that already re-read it.
- e2a2f64: SendGrid now sends `message.metadata` as string `custom_args`. Number, boolean, and `null` values (allowed by `EmailMessage.metadata`) used to reach SendGrid unchanged, and SendGrid rejects non-string `custom_args` with a 400. `null` becomes an empty string, matching Mailgun, Mailtrap, and the other adapters that map metadata.
- e2a2f64: The SES adapter now rejects a message with more than 15 headers with `EmailValidationError` before signing or sending, matching the SES v2 `Message.Headers` limit. Before, SES rejected the request after it was sent. The check runs in client validation and in a direct `adapter.send`.
- 445d658: `send`, `sendMany`, and `validate` now reject a missing message, a non-array `attachments` value (other than `null`, which still means no attachments), or a `null`/non-object entry inside `attachments` with an `EmailValidationError`. `sendPersonalized` gets the same attachment-entry check. Before, these crashed inside the SDK's own validation and surfaced as an `EmailAdapterError` (`adapter: "unknown"`) wrapping a `TypeError`, which looked like a provider failure.
- e2a2f64: Fixes in `sendPersonalized` and send telemetry:

  - A native personalized adapter that resolves without an `accepted` list (possible from plain JavaScript or a custom adapter) now fails with `EmailAllRecipientsFailedError` wrapping an `EmailAdapterError` with `unknown` delivery, instead of a `TypeError`. Fallback does not run, because the provider may have sent. A missing `rejected` list now reads as nothing rejected.
  - `sendPersonalized` checks the abort signal again after `beforeSend` middleware, so a signal aborted during a slow hook stops the send before validation, like `send` already did.
  - The `email sent` telemetry event now describes the message after `beforeSend` middleware, so recipients, attachments, and `sendAt` added by plugins such as `defaultsPlugin` are counted.

- e2a2f64: Routing and option fixes:

  - A fallback list that repeats an adapter name, such as `fallback: { adapters: ["backup", "backup"] }`, now attempts that adapter once instead of once per entry.
  - In `sendMany`, item `retry` and `fallback` options merge one level deep with the method options. An item with `{ retry: { delay } }` used to drop the batch's `retry.maxAttempts`; an item's `fallback.adapters` still replaces the batch list.

## 3.1.0

### Minor Changes

- e0ee155: Fallback now runs by default when the primary provider definitely rejected the request. HTTP adapters report a 4xx response other than 408, 409 and 429 (for example 400, 401, 403, 404 or 422) as `delivery: "not_sent"`, so a client with `fallback` configured tries the next adapter under the default `onUnknownDelivery: "stop"` instead of throwing `EmailRouteError`. Before this change, Resend, Postmark, SES, SendGrid, Mailgun and most other HTTP adapters reported every failure as `unknown`, so fallback only ran with `onUnknownDelivery: "continue"`. Timeouts, network errors, 408, 409, 429 and 5xx responses stay `unknown` and still stop the route. When retries are on and an earlier attempt ended `unknown`, the final failure is now reported `unknown` too, even if the last attempt was a definite rejection, because the earlier attempt may have sent the message. If you relied on a 4xx stopping the route, pass `fallback: { adapters: [] }` for those sends.

  CommonJS builds now share one copy of the error classes (`dist/errors.cjs`) across every entrypoint. Before, an error thrown by an adapter loaded with `require("@opencoredev/email-sdk/resend")` failed `instanceof EmailAdapterError` in the root package, so CommonJS clients lost the adapter's delivery classification and never fell back.

  `require("@opencoredev/email-sdk")` works again. In 3.0.x the CommonJS root entry loaded but threw `ReferenceError: import_core is not defined` as soon as you read `createEmailClient` or any other export, because Bun dropped the module bodies of the re-export-only entry. Subpath entries such as `@opencoredev/email-sdk/resend` were not affected. ESM imports were not affected.

- bb81df3: Add `@opencoredev/email-sdk/inbound` for receiving email. `handleInbound(request, config)` verifies and parses inbound requests from Resend, Postmark, Mailgun, SendGrid Inbound Parse, Amazon SES (SNS and S3), Microsoft Graph, Mailchimp Transactional, SparkPost, Lettr, MailerSend, Brevo, MailPace, Lettermint, Primitive, and JetEmail, and `parseCloudflareInbound` reads Cloudflare Email Workers messages. Every provider returns the same typed `InboundEmail`: addresses, multi-value headers, attachments with `read()`, threading IDs, SPF/DKIM/DMARC/spam verdicts, envelope, and the original payload. Per-provider `verify…`, `parse…`, and `fetch…` functions, plus a dependency-free MIME parser (`parseMimeMessage`), are exported too. The root entrypoint is unchanged.
- 9f32ee0: Telemetry events now report `installation_id_source` (`stored`, `created`, or `ephemeral`) and `hosting_platform` (detected from standard platform environment variables being set, never their values), so usage reports can tell long-lived installations apart from throwaway serverless and container identities.

### Patch Changes

- bb81df3: Fix several send adapter defects. Mailchimp Transactional now reports per-recipient `accepted`/`rejected` and throws a permanent `not_sent` error when every recipient is rejected, instead of returning success. Lettermint and Primitive no longer join a static `idempotency-key` header with the per-send key. Graph, Plunk, and Sequenzy send the text body when `html` is an empty string. Postmark lists every accepted recipient. Scaleway returns the message ID from its `emails` response.
- dc1bda4: Update Nodemailer to 10.5.0.
- 5ba46c0: Sending adds much less work on top of the provider's HTTP call. A client with no plugins or hooks no longer waits on empty middleware and hook lists, resolves the route once per send, and builds telemetry data only when telemetry is on. In the bundled benchmark (`bun bench/overhead.ts`, see `bench/README.md`), SDK overhead per Resend send dropped from about 1.7 µs to 0.8 µs, and per 20-message `sendMany` from about 37 µs to 18 µs.

  SES no longer derives its SigV4 signing key on every send. It still reads `accessKeyId`, `secretAccessKey`, and `sessionToken` from the adapter options on every send, so refreshed STS credentials apply to the next request, and caches only the derived key for each secret, UTC day, region, and service. A signed SES send in the benchmark dropped from about 82 µs to 25 µs, the same as a hand-written signer that also caches its key. Inbound S3 fetches share the same signer and cache. Canonical headers and query parameters are now sorted by character code, as SigV4 requires, instead of by locale.

  Each adapter now keeps its provider limits in its own module, so importing one adapter no longer bundles every provider's validation rules. The minified Resend entry shrinks from 11.4 KB to 8.3 KB.

  Fixes:

  - `send()` no longer fails with "{} is not iterable" when a JavaScript caller passes `headers` as a name-to-value object.
  - `loops()` without a `transactionalId` and `graph()` with an invalid `tokenTimeoutMs` now throw `EmailValidationError` like the other adapter factories, instead of a plain `Error`. The messages are unchanged.

- c13c2c0: Describe the package on npm by what it does: one client for Resend, SendGrid, Postmark, AWS SES, Mailgun and 21 more providers plus SMTP.
- 3dee481: Update the SMTP transport dependency nodemailer to ^10.6.0.
- ceceea2: String addresses now resolve to the right mailbox when the display name or a comment holds angle brackets. The SDK skips quoted strings (with escaped quotes) and RFC 5322 comments, then takes the first `<...>` outside them. This is the address used by SMTP envelope validation, recipient-variable lookups and batch results (including SendGrid and Mailgun batch sends), and the Lettr and SendHeron recipient fields. Adapters that send a name and email pair (SendGrid's `from` and `to` fields, for example) still parse addresses on their own and are unchanged. The SMTP adapter now also builds its envelope (`MAIL FROM` and `RCPT TO`) from these resolved addresses instead of letting Nodemailer re-parse the original strings, so the mailbox the SDK validates is the one it delivers to.

  Changed results:

  - `"Ada <team>" <ada@example.test>` and `"Ada \"<x>\" L" <ada@example.test>` resolve to `ada@example.test` instead of `team` or `x`.
  - `Ada (<team>) <ada@example.test>` resolves to `ada@example.test` instead of `team`.
  - `Ada <ada@example.test (work)>` and `<(work)ada@example.test>` drop the comment inside the angle-addr.
  - `ada@example.test (work)` and `(work) ada@example.test` resolve to `ada@example.test`, so the SMTP adapter accepts them instead of rejecting the whole string.
  - A comment between two tokens counts as a space, so `ada( work )bob@example.test` resolves to `ada bob@example.test` and SMTP validation rejects it.
  - A `,`, `;`, or `:` outside quotes and comments marks an address list or group, which is returned as-is. `Ada <ada@example.test>, evil@example.test` used to resolve to `ada@example.test` while the SMTP adapter delivered to both mailboxes; SMTP validation now rejects it, along with group syntax such as `Team: Ada <ada@example.test>;`.
  - Nested comments and comments with a backslash, such as `Ada (a (<team>) b) <ada@example.test>`, are returned as-is and rejected by SMTP validation, because Nodemailer would read a different mailbox out of them.
  - Input with an unclosed quote or comment, such as `"Ada <ada@example.test>` or `Ada <ada@example.test> (work`, is returned as-is, so validation rejects it instead of picking an address out of it.
  - SMTP envelope validation also rejects `(`, `)`, `,`, `:`, `;`, `"`, and `\` in the resolved address, so bare lists like `ada@example.test,bob@example.test` and quoted local parts like `"ada"@example.test` fail before connecting.

  Bare addresses, IPv6 domain literals such as `ada@[IPv6:2001:db8::1]`, `Name <a@b>`, `Ada <ada@example.test> (work)`, and unclosed or stray angle brackets resolve as before.

- c1a455b: Update Nodemailer to 10.2.1 for SMTP delivery and Zod to 4.6.7 for Convex input validation.
- 57d9da0: `zeptomail()` now throws an `EmailValidationError` ("zeptomail token must be a non-empty string.") when `token` is missing or not a string, such as an un-awaited Promise. It used to crash with a bare `TypeError: options.token.startsWith is not a function`. An empty-string token is now rejected the same way, when the adapter is created; before, it built an adapter whose sends failed ZeptoMail's authentication. Valid tokens behave as before.

## 3.0.1

### Patch Changes

- 18303a4: Telemetry error reports now cover only bugs inside Email SDK. Provider rejections, bad credentials, rate limits, network failures, and errors from caller middleware or custom adapters are no longer sent as `$exception` events. Instead, `email sent` and `email adapter attempted` record them as a `failure_kind` (`auth`, `rate_limited`, `rejected`, `provider_error`, `network`, `caller`, or `unexpected`), along with the provider's `http_status`. Reports group by the SDK frame that failed rather than by caller code. `EmailAllRecipientsFailedError` keeps its real name in reports. Messages are also scrubbed of hostnames and IP addresses, and `sdk_version` is compiled in, so bundled apps stop reporting `unknown`.

## 3.0.0

### Major Changes

- ccec883: Tighten types at the SDK's input boundaries. This is a breaking change for TypeScript users who pass metadata that is not plain JSON-like data. See the [v2 to v3 migration guide](https://email-sdk.dev/docs/guides/migrate/v2-to-v3).

  - `createEmailAgentTools` now returns a named `EmailAgentTools` type. `sendEmail.parameters` is typed as a JSON object, and `sendEmail.execute` resolves to `EmailSendResult` instead of `unknown`.
  - `NormalizedWebhookEvent.payload` is typed as a parsed JSON object instead of `Record<string, unknown>`.
  - `JsonObject` and `JsonValue` are exported from the `webhooks` and `agent-tools` entry points so these types can be named.
  - The compat `EmailRetryConfig.delay` and `shouldRetry` callbacks now receive the `EmailSdkError` the client already passed them at runtime.
  - Send-option `metadata` (on `send()` options, hook events, adapter contexts, and the capture and observability plugins) is now typed as `EmailSendMetadata`. By default that is `EmailMetadataRecord`: strings, numbers, booleans, `null`, `undefined`, `Date`, and arrays or plain objects of those. Metadata that holds class instances, functions, or values typed by an `interface` no longer type-checks; spread it into a plain object or register your own shape.
  - To give metadata your own shape, augment `EmailMetadataRegister`:

    ```ts
    import "@opencoredev/email-sdk";

    declare module "@opencoredev/email-sdk" {
      interface EmailMetadataRegister {
        metadata: { tenantId: string };
      }
    }
    ```

    Hooks and plugins then see `event.metadata?.tenantId` as a `string`.

  - Iterable `dataFields` is typed as `EmailMetadataRecord`, and the SMTP `tls` option now uses nodemailer's own TLS options type.
  - Provider responses are now parsed through shared JSON helpers. Malformed or `null` success bodies are treated like empty bodies, and non-string entries in accepted or rejected recipient lists are ignored instead of passed through.

  Migrating metadata from 2.x:

  Before (compiles in 2.x, fails in 3.0):

  ```ts
  interface AuditInfo {
    userId: string;
  }

  const audit: AuditInfo = { userId: "user_123" };

  await email.send(message, {
    metadata: { audit, link: new URL(receiptUrl) },
  });
  ```

  After:

  ```ts
  await email.send(message, {
    metadata: { audit: { ...audit }, link: new URL(receiptUrl).toString() },
  });
  ```

  Spread interface-typed values into plain objects (or declare them with `type` instead of `interface`), convert class instances such as `URL` to strings, and replace `Record<string, unknown>` metadata with `EmailMetadataRecord` or a registered shape.

### Minor Changes

- 6880ed6: Make telemetry easier to opt out of. `email-sdk telemetry disable` saves a machine-wide opt-out (`status` and `enable` are also available), `disableTelemetry()` turns telemetry off for every client in the process, and `getTelemetryStatus()` reports which setting decided the current state.
- 558c7e7: Add a Helo adapter (`@opencoredev/email-sdk/helo`) with native idempotency keys, an optional `channelId` for all-Channel credentials, attachments, tags, metadata, and a `doctor --live` check that authenticates without sending. Sends Helo reports as failed are non-retryable errors. The Convex component accepts `adapter: "helo"` with `HELO_API_KEY` and an optional `HELO_CHANNEL_ID`.
- 6bcfe96: Add a SendHeron adapter (`@opencoredev/email-sdk/sendheron`) with native idempotency keys, `sendAt` scheduling, attachments, and a `doctor --live` check that authenticates without sending. Suppressed sends are reported as non-retryable errors. The Convex component accepts `adapter: "sendheron"` with `SENDHERON_API_KEY`.

### Patch Changes

- 84f308a: Update Nodemailer to its latest compatible patch release. Telemetry now stays off when the telemetry settings file or its directory can't be read (for example, a permissions error), so an unreadable config directory can no longer override a saved opt-out.

## 2.0.0

### Major Changes

- e0827a3: Replace the hand-rolled SMTP protocol and MIME implementation with Nodemailer-backed delivery, including RFC-safe subject encoding, transfer encoding, and attachments. Add first-class CommonJS entry points alongside ESM. Telemetry remains enabled by default with the existing `telemetry: false`, `EMAIL_SDK_TELEMETRY=0`, and `DO_NOT_TRACK=1` opt-outs; events use a stable installation identifier and never include message content, addresses, or credentials. Move repository CI workflows to Tenki Cloud runners and add Node 20/22/24 package-compatibility coverage.

### Minor Changes

- 3b7a833: Add Microsoft Graph adapter (`graph`) for sending email through Microsoft 365 and Azure AD using the Microsoft Graph sendMail API with OAuth 2.0 client credentials flow. The adapter supports both client secret and custom `getAccessToken` options (for managed identity, certificate credentials, or external token providers), automatic token caching with refresh skew, mailbox resolution via user ID or UPN, and optional `saveToSentItems` control. Graph enforces x- prefixed custom headers only and caps combined recipients at 1,000. The adapter is available via `@opencoredev/email-sdk/graph` and through the CLI with `--adapter graph`.
- 3e07cf2: Add opt-in `doctor --live`, `--from`, and `--json` diagnostics with independently reported `configuration`, `authentication`, and `sender` checks. Default `doctor` stays configuration-only and makes no network request. Live probes use documented non-sending endpoints for Resend, Sequenzy, JetEmail, Primitive, Lettermint, and Lettr; Resend additionally supports paginated sender-domain readiness via `--from`, while other adapters report sender readiness as `unsupported`. Results distinguish `invalid_credentials`, `insufficient_permissions`, `inconclusive`, `rate_limited`, `network_failure`, `timeout`, `unsupported`, and `not_ready`; generic HTTP 400/422 responses are never treated as authentication success. Probes are bounded by a timeout, reject redirects and non-loopback base URL overrides, and never print credentials, response bodies, or account identifiers. The live verification scripts reuse the same probes.
- 3e07cf2: Add a separate webhooks entry point with Web Crypto Resend and Mailgun signature verification, timestamp checks and key rotation, plus delivery event normalization for Resend, Postmark, and Mailgun.
- 14a6dc0: Allow CommonJS applications on Node.js `^20.19.0 || >=22.12.0` (20.19+ on 20.x, or 22.12+) to load every SDK entry point with `require()`. ESM imports still support Node.js 20+. Typed CommonJS consumers need TypeScript 5.8+ with `module: nodenext`, or a compiler supporting `module: node20`. On older supported runtimes, use dynamic `import()` instead.

### Patch Changes

- bcf0306: Ensure the packaged CLI is executable when builds run with a restrictive file-creation mask.
- 9a40f72: Add the missing CommonJS export for the Microsoft Graph adapter entry point.
- 97ab553: Ensure per-send idempotency keys override static Resend and JetEmail adapter headers.
- 3e07cf2: Correct anonymous usage measurements by separating logical send outcomes, adapter attempts, submitted volume, and explicit provider acceptance. Version the counting schema, replace the misleading `delivered_count` metric, exclude built-in test adapters from provider volume even when renamed, and preserve acceptance evidence when later middleware fails. Default-on telemetry and existing opt-outs remain unchanged. Document aggregation rules and why provider acceptance does not establish delivery.
- 4381362: Fix the SMTP adapter marking every send failure as retryable. Permanent SMTP rejections (5xx replies), authentication and envelope errors, protocol errors, and TLS certificate failures are now classified as non-retryable, while transient failures (4xx replies, connection failures, timeouts, DNS resolution failures, and non-certificate TLS failures) remain retryable.

  SMTP failures that prove the server never accepted the message now also report `delivery: "not_sent"`. Failures that could have happened after the server queued the message continue to report `delivery: "unknown"`.

## 1.2.0

### Minor Changes

- 3b46d04: Add support for Cloudflare Email Workers binding (`SendEmail`) in `cloudflare` adapter.
- 92d4fb6: Add a Lettr adapter for transactional sends through Lettr's REST API. Convex Email now preserves normalized provider failure metadata and does not retry non-retryable delivery failures.

## 1.1.0

### Minor Changes

- 6430485: Add `client.flush()` and exact message counts to anonymous telemetry.

  Sends fire telemetry without awaiting it, so serverless runtimes froze the process on response and dropped the request, undercounting the platforms most transactional email ships from. `client.flush()` waits for in-flight telemetry, never rejects, and resolves immediately when telemetry is disabled.

  `email sent` now carries `message_count` (1 per `send()` regardless of recipient count, one per recipient for `sendPersonalized()`) and `delivered_count` (messages the provider accepted), so a personalized send to 500 recipients no longer reports as a single email.

## 1.0.1

### Patch Changes

- 1eaa029: License the SDK packages under MIT. Future cloud application code remains AGPL-3.0-only.

## 1.0.0

### Major Changes

- 86d54a4: Ship the v1 adapter-first SDK and CLI contract.

  Breaking changes:

  - Provider terminology is now adapter-first across the public SDK: configure `adapters`, `defaultAdapter`, and `fallback.adapters`; select routes with `adapter` / `withAdapter`; and implement `EmailAdapter` with a literal `name` and capability metadata. Legacy provider aliases live in the one-major `/compat` bridge for migration.
  - Adapter subpath option types now use `*AdapterOptions`, and the testing entry point exports `memoryAdapter`, `failingAdapter`, and `MemoryAdapter`.
  - Message-level `idempotencyKey` moves into send options, retry configuration uses `retry.maxAttempts`, fallback is explicit and stops on unknown delivery by default, and provider failures are normalized into structured `EmailSdkError` subclasses.
  - `send` now returns a normalized `EmailSendResult` with adapter, accepted/rejected, id, and raw provider data; multi-message sending uses sequential `sendMany` and returns ordered settled results instead of throwing away partial success.
  - Per-recipient template values now use `sendPersonalized({ message, recipients })`; adapters can declare native, expanded, or unsupported personalized capability and implement optional `sendPersonalized` for provider-native fanout.

  Also included in v1:

  - Shared no-network validation, explicit adapter capabilities, install-safe declaration maps, plugin and middleware hooks, and adapter-scoped helpers. Direct built-in adapter sends now enforce the same validation as `validate()` before provider calls, empty optional recipient arrays are treated as absent for narrow adapters, and SMTP preserves repeated custom headers while rejecting custom `Bcc` headers so blind-copy recipients stay RCPT-only.
  - Built-in routing and whole-send timeout plugins alongside defaults, capture, and observability.
  - Optional `sendAt` scheduling for adapters with native provider scheduling; invalid timestamps fail validation, unsupported adapters reject scheduling instead of queueing or sending immediately, and the CLI keeps message-level `--send-at` separate from Iterable's `--iterable-send-at` adapter option.
  - Anonymous SDK and CLI telemetry with redacted error reporting, opt-outs via `EMAIL_SDK_TELEMETRY=0`, `DO_NOT_TRACK=1`, or `createEmailClient({ telemetry: false })`, and test-mode disabling. Telemetry records adapter/command names, success/failure counts, durations, recipient counts, scheduling flags, and sanitized error metadata, never content, addresses, headers, or credentials.
  - Optional `/ai` entry point exposing `createEmailTools`, a client-bound `sendEmail` tool for Chat SDK and AI SDK compositions that requires approval and uses tool-call idempotency metadata.
  - Optional `/react` entry point exposing `renderEmail` plus email-safe shadcn-themed layout, card, text, button, and separator components. React templates render to HTML and plain text for the normal provider-independent send pipeline without adding React to the root SDK path.

## 0.6.5

### Patch Changes

- 5614c4c: Add the Lettermint adapter (`@opencoredev/email-sdk/lettermint`) for [Lettermint](https://lettermint.co)'s European transactional email API. It posts the normalized `EmailMessage` to `POST /v1/send` over `fetch`, authenticates with the `x-lettermint-token` header, base64-encodes attachments, maps a single normalized tag plus string metadata, and forwards `idempotencyKey` as the `Idempotency-Key` header. An optional `route` targets a specific Lettermint route, and more than one tag fails fast with an `EmailValidationError`.

## 0.6.4

### Patch Changes

- 3ca47bb: Add the Primitive adapter (`@opencoredev/email-sdk/primitive`) for [Primitive](https://www.primitive.dev)'s email API for AI agents. It posts the normalized `EmailMessage` to `POST /v1/send-mail` over `fetch`, base64-encodes attachments, and forwards `idempotencyKey` as Primitive's `Idempotency-Key` header. Primitive's send API targets a single recipient and has no CC, BCC, reply-to, custom headers, tags, or metadata, so the adapter rejects those fields — and a second recipient — up front instead of silently dropping them, consistent with the SDK's fail-fast field support.

## 0.6.3

### Patch Changes

- 3c520c9: Add the JetEmail adapter (`@opencoredev/email-sdk/jetemail`) for the JetEmail transactional email API. It maps CC, BCC, reply-to, custom headers, and base64 attachments, forwards `idempotencyKey` as JetEmail's `Idempotency-Key` header, and fails fast with a clear error when `from` is missing a display name (JetEmail requires the `"Name <email>"` form). Tags and metadata are rejected before the request, consistent with the SDK's fail-fast field support.

## 0.6.2

### Patch Changes

- 9c8ff24: Reject SMTP envelope addresses and header names that contain control characters, whitespace, or angle brackets before connecting. This closes an SMTP command/header injection vector where a crafted recipient address or header name could smuggle extra SMTP commands or headers into the session.

## 0.6.1

### Patch Changes

- c80935f: Add the Convex Email component package with durable queued sends, retries, fallback adapters, idempotency, webhook ingestion, and test-mode delivery controls.

  Ship the component alongside a patch SDK release so the docs, package entrypoints, and provider surface move forward as `0.6.1` instead of a larger version jump.

## 0.6.0

### Minor Changes

- 4db1cd7: Add an official Iterable adapter for target campaign email sends.
- 2b1fbf1: Add the Sequenzy transactional email adapter, CLI support, docs, tests, and a local API-auth smoke check.

## 0.5.0

### Minor Changes

- 074d2a2: Add the Unosend REST API adapter, including the package subpath export, CLI adapter support, payload mapping, docs, and provider catalog entry.

## 0.4.0

### Minor Changes

- Add and harden the Cloudflare Email Sending adapter for the REST API, including the SDK subpath export, CLI adapter support, payload validation, response-envelope validation, tests, and docs.

### Patch Changes

- 40f787a: Run the CLI with Node as well as Bun and document the scoped npx command for one-off CLI usage.
- 2640992: Fix CLI dry-run adapter validation, CLI credential checks, batch routing aliases, and retry handling for transient transport errors.
- b9eb02f: Improve npm package metadata and README links for the Email SDK launch.
- 76fc0ef: Align provider adapters with current API docs for MailerSend response IDs, Mailtrap metadata and response IDs, Scaleway payload shape, Plunk send fields and response IDs, and Loops transactional ID validation and attachments.

## 0.3.0

### Minor Changes

- 6b59659: Add the Email SDK plugin system with built-in defaults, observability, and capture plugins, plus docs for publishing community plugins and adapter plugins.

### Patch Changes

- 17e8a6f: Add an `email-sdk version` CLI command so users and agents can verify the installed SDK and CLI version.
- 2359d77: Clarify CLI installation and one-off `bunx` usage in the package docs.

## 0.2.0

### Minor Changes

- c092005: Prepare the first public scoped release with automated versioning, npm publishing, and CLI distribution metadata.
