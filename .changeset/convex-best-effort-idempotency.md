---
"@opencoredev/convex-email": patch
---

The sender action passes `idempotency: "best-effort"` with each email's `idempotencyKey`. The component already deduplicates by that key, so emails keep sending through adapters without provider-side idempotency, such as SendGrid or SES, when `@opencoredev/email-sdk` rejects a strict key on those adapters.
