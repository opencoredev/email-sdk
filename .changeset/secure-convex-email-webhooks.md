---
"@opencoredev/convex-email": major
---

Secure webhook routes by default, harden URL attachment fetching, and type the component API.

**Breaking: `registerRoutes()` requires webhook verification.** Calling it without `verify` now throws. Use the new verifier helpers, pass your own function, or opt out explicitly for local development.

Before:

```ts
email.registerRoutes(http, { providers: ["resend"] });
```

After:

```ts
import { resendWebhookVerifier, verifyByProvider } from "@opencoredev/convex-email";

email.registerRoutes(http, {
  providers: ["resend"],
  verify: verifyByProvider({
    resend: resendWebhookVerifier({ secret: process.env.RESEND_WEBHOOK_SECRET! }),
  }),
});

// Local development only. Logs a warning; never deploy this.
email.registerRoutes(http, { providers: ["resend"], unsafeAllowUnverifiedWebhooks: true });
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
