---
"@opencoredev/email-sdk": patch
---

`native` send options are now rejected with an `EmailValidationError` (wrapped in `EmailMiddlewareError` when they come from options a `beforeSend` middleware returned) when they contain a cycle, or when the SDK's copy of them goes over a budget of 1,000,000 units (each value, array slot including sparse ones, object key, and native map entry counts as one) or 32 Mi UTF-16 code units of strings and keys. All adapter entries of one send share the budget, and built-in adapters called directly apply the same checks to the native entry they receive. It measures the copied data, not the serialized request size. Before, the snapshot limited only nesting depth, so an object reused across many fields could be copied into far more data than it held before provider validation ran.
