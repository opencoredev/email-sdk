---
"@opencoredev/email-sdk": minor
"@opencoredev/convex-email": minor
---

Add an eusend adapter (`@opencoredev/email-sdk/eusend`) with native idempotency keys, scheduled sends through `sendAt`, attachments, tags, and a `doctor --live` check that authenticates full-access and sending-access keys without sending. Idempotency keys longer than eusend stores are hashed, and recipient display names, tag charsets, and per-field limits are checked before any request. The Convex component accepts `adapter: "eusend"` with `EUSEND_API_KEY`.
