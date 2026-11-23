---
"@opencoredev/email-sdk": patch
---

Fixes in `sendPersonalized` and send telemetry:

- A native personalized adapter that resolves without an `accepted` list (possible from plain JavaScript or a custom adapter) now fails with `EmailAllRecipientsFailedError` wrapping an `EmailAdapterError` with `unknown` delivery, instead of a `TypeError`. Fallback does not run, because the provider may have sent. A missing `rejected` list now reads as nothing rejected.
- `sendPersonalized` checks the abort signal again after `beforeSend` middleware, so a signal aborted during a slow hook stops the send before validation, like `send` already did.
- The `email sent` telemetry event now describes the message after `beforeSend` middleware, so recipients, attachments, and `sendAt` added by plugins such as `defaultsPlugin` are counted.
