---
"@opencoredev/email-sdk": patch
---

`handleInbound` from `@opencoredev/email-sdk/inbound` caps the request body it reads before verifying the signature. The new `maxBodyBytes` option defaults to `DEFAULT_INBOUND_MAX_BODY_BYTES` (50 MiB). A larger `Content-Length` is refused before reading, and a chunked or mislabeled body is cancelled once it passes the limit, both with the new `InboundError` reason `payload_too_large` (respond 413). `Infinity` disables the limit.
