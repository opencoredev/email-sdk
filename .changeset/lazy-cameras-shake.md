---
"@opencoredev/email-sdk": patch
"@opencoredev/convex-email": patch
---

Performance fixes: cache the AWS SigV4 signing key per SES adapter instance instead of re-deriving it on every send, reuse the static request URL and headers in JSON-based adapters, and read the Convex Email config document once per `enqueueBatch` mutation instead of once per message.
