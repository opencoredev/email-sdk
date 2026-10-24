---
"@opencoredev/email-sdk": patch
---

Sending adds much less work on top of the provider's HTTP call. A client with no plugins or hooks no longer waits on empty middleware and hook lists, resolves the route once per send, and builds telemetry data only when telemetry is on. In the bundled benchmark (`bun bench/overhead.ts`), SDK overhead per Resend send dropped from about 2.3 µs to 0.9 µs, and per 20-message `sendMany` from about 72 µs to 30 µs.

SES caches its SigV4 signing key for each UTC day instead of deriving it on every send, which makes a signed SES send about three times faster. It also sorts canonical headers by character code, as SigV4 requires, instead of by locale.

Each adapter now keeps its provider limits in its own module, so importing one adapter no longer bundles every provider's validation rules. The minified Resend entry shrinks from 11.4 KB to 8.1 KB.

Fixes:

- `send()` no longer fails with "{} is not iterable" when a JavaScript caller passes `headers` as a name-to-value object.
- `loops()` without a `transactionalId` and `graph()` with an invalid `tokenTimeoutMs` now throw `EmailValidationError` like the other adapter factories, instead of a plain `Error`. The messages are unchanged.
