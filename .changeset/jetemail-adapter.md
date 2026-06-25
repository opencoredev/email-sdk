---
"@opencoredev/email-sdk": minor
---

Add the JetEmail adapter (`@opencoredev/email-sdk/jetemail`) for the JetEmail transactional email API. It maps CC, BCC, reply-to, custom headers, and base64 attachments, forwards `idempotencyKey` as JetEmail's `Idempotency-Key` header, and fails fast with a clear error when `from` is missing a display name (JetEmail requires the `"Name <email>"` form). Tags and metadata are rejected before the request, consistent with the SDK's fail-fast field support.
