---
"@opencoredev/email-sdk": patch
---

`send`, `validate`, and the other send paths now reject a missing message, a non-array `attachments` value, or a `null`/non-object entry inside `attachments` with an `EmailValidationError`. Before, these crashed inside the SDK's own validation and surfaced as an `EmailAdapterError` (`adapter: "unknown"`) wrapping a `TypeError`, which looked like a provider failure.
