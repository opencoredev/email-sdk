---
"@opencoredev/email-sdk": minor
"@opencoredev/convex-email": minor
---

Add a SendHeron adapter (`@opencoredev/email-sdk/sendheron`) with native idempotency keys, `sendAt` scheduling, attachments, and a `doctor --live` check that authenticates without sending. Suppressed sends are reported as non-retryable errors. The Convex component accepts `adapter: "sendheron"` with `SENDHERON_API_KEY`.
