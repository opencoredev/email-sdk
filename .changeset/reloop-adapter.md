---
"@opencoredev/email-sdk": minor
"@opencoredev/convex-email": minor
---

Add a Reloop adapter (`@opencoredev/email-sdk/reloop`) for Reloop Cloud and self-hosted Reloop, with native idempotency keys, scheduled sends through `sendAt`, attachments, tags, and a `doctor --live` check that authenticates with a read-only domain list. The Convex component accepts `adapter: "reloop"` with `RELOOP_API_KEY`.
