---
"@opencoredev/email-sdk": minor
---

Add the Lettermint adapter (`@opencoredev/email-sdk/lettermint`) for [Lettermint](https://lettermint.co)'s European transactional email API. It posts the normalized `EmailMessage` to `POST /v1/send` over `fetch`, authenticates with the `x-lettermint-token` header, base64-encodes attachments, maps a single normalized tag plus string metadata, and forwards `idempotencyKey` as the `Idempotency-Key` header. An optional `route` targets a specific Lettermint route, and more than one tag fails fast with an `EmailValidationError`.
