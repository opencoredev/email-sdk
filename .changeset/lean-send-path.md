---
"@opencoredev/email-sdk": patch
---

Sending adds much less work on top of the provider's HTTP call. A client with no plugins or hooks no longer waits on empty middleware and hook lists, resolves the route once per send, and builds telemetry data only when telemetry is on. In the bundled benchmark (`bun bench/overhead.ts`, see `bench/README.md`), SDK overhead per Resend send dropped from about 1.7 µs to 0.8 µs, and per 20-message `sendMany` from about 37 µs to 18 µs.

SES no longer derives its SigV4 signing key on every send. It still reads `accessKeyId`, `secretAccessKey`, and `sessionToken` from the adapter options on every send, so refreshed STS credentials apply to the next request, and caches only the derived key for each secret, UTC day, region, and service. A signed SES send in the benchmark dropped from about 82 µs to 25 µs, the same as a hand-written signer that also caches its key. Inbound S3 fetches share the same signer and cache. Canonical headers and query parameters are now sorted by character code, as SigV4 requires, instead of by locale.

Each adapter now keeps its provider limits in its own module, so importing one adapter no longer bundles every provider's validation rules. The minified Resend entry shrinks from 11.4 KB to 8.3 KB.

Fixes:

- `send()` no longer fails with "{} is not iterable" when a JavaScript caller passes `headers` as a name-to-value object.
- `loops()` without a `transactionalId` and `graph()` with an invalid `tokenTimeoutMs` now throw `EmailValidationError` like the other adapter factories, instead of a plain `Error`. The messages are unchanged.
