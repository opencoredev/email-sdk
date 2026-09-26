# @opencoredev/convex-email

## 5.0.0

### Major Changes

- 7c01879: Secure webhook routes by default, harden URL attachment fetching, and type the component API.

  **Breaking: `registerRoutes()` requires webhook verification.** Calling it without `verify` now throws. Use the new verifier helpers, pass your own function, or opt out explicitly for local development.

  Before:

  ```ts
  email.registerRoutes(http, { providers: ["resend"] });
  ```

  After:

  ```ts
  import {
    resendWebhookVerifier,
    verifyByProvider,
  } from "@opencoredev/convex-email";

  email.registerRoutes(http, {
    providers: ["resend"],
    verify: verifyByProvider({
      resend: resendWebhookVerifier({
        secret: process.env.RESEND_WEBHOOK_SECRET!,
      }),
    }),
  });

  // Local development only. Logs a warning; never deploy this.
  email.registerRoutes(http, {
    providers: ["resend"],
    unsafeAllowUnverifiedWebhooks: true,
  });
  ```

  The new helpers are `resendWebhookVerifier`, `mailgunWebhookVerifier`, `postmarkBasicAuthVerifier`, and `verifyByProvider`. The Resend and Mailgun helpers check signatures with `@opencoredev/email-sdk/webhooks`. Each helper rejects requests for other providers, and `verifyByProvider` rejects providers it has no verifier for. Custom `verify` functions keep the same `{ provider, request, body, headers }` signature.

  **Fix: webhook routes now reach the component.** `worker.handleWebhook` was an internal component function, which the host app cannot call, so routes created by `registerRoutes()` failed at runtime. It is now a public component action. Component functions are only callable by the app that mounts the component, never by clients.

  **Breaking: stricter types.** `new ConvexEmail(component)` now expects the typed component API (`ConvexEmailComponentApi`, also exported as `ComponentApi` from `_generated/component`). Pass `components.convexEmail` from your generated `api` as before. Code that passed an untyped `any` reference may need a type fix. Records returned by `status`, `listEvents`, and the `exposeApi()` functions are validated with ids as strings.

  Before:

  ```ts
  const email = new ConvexEmail(components.convexEmail as any);
  ```

  After:

  ```ts
  const email = new ConvexEmail(components.convexEmail);
  ```

  **Behavior change: malformed email ids.** `status` returns `null`, `listEvents` returns `[]`, and `cancel` and `retry` return `false` for an id that is not a valid email id, instead of throwing.

  **Security: URL attachments.** The component now resolves the attachment host before every request, rejects the fetch when any resolved address is private, loopback, link-local, or otherwise non-public (including IPv4-mapped, NAT64, and 6to4 forms), and pins the connection to the checked addresses so DNS rebinding cannot redirect it. Redirects are followed manually for at most 3 hops, each checked the same way. The request asks for an uncompressed body and rejects a response with any other `Content-Encoding`, and the socket is paused while the body waits to be read so the 10 MB cap bounds memory. New errors: `Attachment "<name>" URL host could not be resolved.`, `Attachment "<name>" URL host resolves to a non-public address.`, and `Attachment "<name>" was sent with unsupported content encoding "<encoding>".`

  The package now depends on `zod`.

### Minor Changes

- 558c7e7: Add a Helo adapter (`@opencoredev/email-sdk/helo`) with native idempotency keys, an optional `channelId` for all-Channel credentials, attachments, tags, metadata, and a `doctor --live` check that authenticates without sending. Sends Helo reports as failed are non-retryable errors. The Convex component accepts `adapter: "helo"` with `HELO_API_KEY` and an optional `HELO_CHANNEL_ID`.
- 6bcfe96: Add a SendHeron adapter (`@opencoredev/email-sdk/sendheron`) with native idempotency keys, `sendAt` scheduling, attachments, and a `doctor --live` check that authenticates without sending. Suppressed sends are reported as non-retryable errors. The Convex component accepts `adapter: "sendheron"` with `SENDHERON_API_KEY`.

### Patch Changes

- Updated dependencies [558c7e7]
- Updated dependencies [ccec883]
- Updated dependencies [6bcfe96]
  - @opencoredev/email-sdk@2.1.0

## 4.0.0

### Major Changes

- 32e98c9: Secure `exposeApi()` with authenticated ownership checks. Unauthenticated callers can no longer send, read, cancel, or retry email records; use `authorize` for custom tenant or operation policy, and `authorizeConfig` for explicitly authorized configuration access.

### Minor Changes

- 3b7a833: Add Microsoft Graph adapter (`graph`) for sending email through Microsoft 365 and Azure AD using the Microsoft Graph sendMail API with OAuth 2.0 client credentials flow. The adapter supports both client secret and custom `getAccessToken` options (for managed identity, certificate credentials, or external token providers), automatic token caching with refresh skew, mailbox resolution via user ID or UPN, and optional `saveToSentItems` control. Graph enforces x- prefixed custom headers only and caps combined recipients at 1,000. The adapter is available via `@opencoredev/email-sdk/graph` and through the CLI with `--adapter graph`.

### Patch Changes

- 308074d: Prevent stale recovered email workers from overwriting the active worker's result.
- 3e07cf2: Require Email SDK ^1.3.0 for the shared webhook export used by the component. SDK 1.2.0 does not provide this entry point; the accumulated SDK minor changesets introduce it in 1.3.0.
- 3e07cf2: Reuse the SDK webhook normalizer for Resend, Postmark, and Mailgun, reject malformed non-object payloads, and handle Resend delivery headers case-insensitively while preserving optional application verification and generic-provider compatibility.
- bcf0306: Harden remote attachment downloads by validating every redirect, limiting redirects and response size, and applying a fetch timeout.
- Updated dependencies [3b7a833]
- Updated dependencies [3e07cf2]
- Updated dependencies [bcf0306]
- Updated dependencies [9a40f72]
- Updated dependencies [97ab553]
- Updated dependencies [3e07cf2]
- Updated dependencies [4381362]
- Updated dependencies [e0827a3]
- Updated dependencies [3e07cf2]
- Updated dependencies [14a6dc0]
  - @opencoredev/email-sdk@2.0.0

## 3.0.0

### Minor Changes

- 92d4fb6: Add a Lettr adapter for transactional sends through Lettr's REST API. Convex Email now preserves normalized provider failure metadata and does not retry non-retryable delivery failures.

### Patch Changes

- Updated dependencies [3b46d04]
- Updated dependencies [92d4fb6]
  - @opencoredev/email-sdk@1.2.0

## 2.0.0

### Minor Changes

- e555af3: Support every built-in Email SDK adapter in the Convex component, including Lettermint, JetEmail, and Primitive.

  Adapter configuration is now driven by a single registry (`src/shared/adapters.ts`) that declares each adapter's options, default environment variables, and which fields may be set inline. The wire validators, the `ConvexEmailAdapterConfig` union, the component's declared environment, and runtime option resolution are all derived from that registry, so a new adapter needs one registry entry plus one factory line rather than four parallel edits.

  The wire format is unchanged for existing adapters. `LOOPS_TRANSACTIONAL_ID` is now declared in the component environment, so the Loops adapter can actually read it.

### Patch Changes

- Updated dependencies [6430485]
  - @opencoredev/email-sdk@1.1.0

## 1.0.1

### Patch Changes

- 1eaa029: License the SDK packages under MIT. Future cloud application code remains AGPL-3.0-only.
- Updated dependencies [1eaa029]
  - @opencoredev/email-sdk@1.0.1

## 1.0.0

### Minor Changes

- 86d54a4: Publish the Convex component with durable multi-provider email queues, reactive status, webhook history, test-mode redirection, and manual recovery for terminal failures.

### Patch Changes

- Updated dependencies [86d54a4]
  - @opencoredev/email-sdk@1.0.0

## 0.1.0

### Minor Changes

- c80935f: Add the Convex Email component package with durable queued sends, retries, fallback adapters, idempotency, webhook ingestion, and test-mode delivery controls.

  Ship the component alongside a patch SDK release so the docs, package entrypoints, and provider surface move forward as `0.6.1` instead of a larger version jump.

### Patch Changes

- Updated dependencies [c80935f]
  - @opencoredev/email-sdk@0.6.1
