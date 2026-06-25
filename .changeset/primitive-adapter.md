---
"@opencoredev/email-sdk": minor
---

Add the Primitive adapter (`@opencoredev/email-sdk/primitive`) for [Primitive](https://www.primitive.dev)'s email API for AI agents. It posts the normalized `EmailMessage` to `POST /v1/send-mail` over `fetch`, base64-encodes attachments, and forwards `idempotencyKey` as Primitive's `Idempotency-Key` header. Primitive's send API targets a single recipient and has no CC, BCC, reply-to, custom headers, tags, or metadata, so the adapter rejects those fields — and a second recipient — up front instead of silently dropping them, consistent with the SDK's fail-fast field support.
