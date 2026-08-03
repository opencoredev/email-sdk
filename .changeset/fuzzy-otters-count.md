---
"@opencoredev/email-sdk": minor
---

Add `client.flush()` and exact message counts to anonymous telemetry.

Sends fire telemetry without awaiting it, so serverless runtimes froze the process on response and dropped the request, undercounting the platforms most transactional email ships from. `client.flush()` waits for in-flight telemetry, never rejects, and resolves immediately when telemetry is disabled.

`email sent` now carries `message_count` (1 per `send()` regardless of recipient count, one per recipient for `sendPersonalized()`) and `delivered_count` (messages the provider accepted), so a personalized send to 500 recipients no longer reports as a single email.
