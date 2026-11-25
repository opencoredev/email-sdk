---
"@opencoredev/email-sdk": minor
"@opencoredev/convex-email": minor
---

Add a Nightmail adapter (`@opencoredev/email-sdk/nightmail`) with native idempotency keys, scheduling through `sendAt`, cc, bcc, reply-to, custom headers, and attachments uploaded to Nightmail before the send with idempotency keys derived from the send's key. Add `verifyNightmailInbound` and `parseNightmailInbound` (and `handleInbound({ provider: "nightmail" })`) for Nightmail's signed `inbound`-format webhooks, plus a `doctor --live` check that reads `GET /v1/me` without sending. The Convex component accepts `adapter: "nightmail"` with `NIGHTMAIL_API_KEY`.
