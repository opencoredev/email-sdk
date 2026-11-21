---
"@opencoredev/email-sdk": patch
---

`send`, `sendMany`, and `validate` now reject a missing message, a non-array `attachments` value (other than `null`, which still means no attachments), or a `null`/non-object entry inside `attachments` with an `EmailValidationError`. `sendPersonalized` gets the same attachment-entry check. Before, these crashed inside the SDK's own validation and surfaced as an `EmailAdapterError` (`adapter: "unknown"`) wrapping a `TypeError`, which looked like a provider failure.
