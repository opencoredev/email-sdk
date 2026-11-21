---
"@opencoredev/email-sdk": major
---

`idempotencyKey` is no longer dropped silently. When any adapter on the route (primary or fallback) reports `capabilities.idempotency: "none"`, `send`, `sendMany` items, `sendPersonalized`, and `validate` now throw `EmailValidationError` before any request, because that adapter cannot deduplicate a retried send. Twenty built-in adapters report `"none"`, including SendGrid, Postmark, SES, Mailgun, and Brevo.

Behavior change: a send that passed `idempotencyKey` to one of those adapters used to succeed without deduplication and now fails. To keep sending, either remove the key, route to an adapter with native idempotency (Resend, JetEmail, Lettermint, Primitive, SendHeron, Helo) or SMTP, or pass the new send option `idempotency: "best-effort"`:

```ts
// Before: the key was ignored on SendGrid.
await email.send(message, { adapter: "sendgrid", idempotencyKey: "receipt:42" });

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
