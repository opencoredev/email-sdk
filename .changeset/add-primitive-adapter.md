---
"@opencoredev/email-sdk": minor
---

Add a `primitive` adapter that sends through Primitive's outbound relay (`/send-mail`). Import it from `@opencoredev/email-sdk/primitive`, authenticate with a `prim_`-prefixed API key, and optionally pass `wait`/`waitTimeoutMs` to block on the first downstream SMTP delivery outcome. The adapter maps `from`, `to`, `subject`, `text`, `html`, and `attachments`; it accepts a single recipient and rejects `cc`, `bcc`, `replyTo`, `headers`, `tags`, and `metadata` with an `EmailValidationError` before any request is made. The CLI (`adapters`, `doctor`, `send`) recognizes `primitive` via `PRIMITIVE_API_KEY`.
