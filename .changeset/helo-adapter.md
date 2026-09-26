---
"@opencoredev/email-sdk": minor
"@opencoredev/convex-email": minor
---

Add a Helo adapter (`@opencoredev/email-sdk/helo`) with native idempotency keys, an optional `channelId` for all-Channel credentials, attachments, tags, metadata, and a `doctor --live` check that authenticates without sending. Sends Helo reports as failed are non-retryable errors. The Convex component accepts `adapter: "helo"` with `HELO_API_KEY` and an optional `HELO_CHANNEL_ID`.
