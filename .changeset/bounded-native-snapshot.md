---
"@opencoredev/email-sdk": patch
---

`native` send options are now rejected with an `EmailValidationError` when they contain a cycle, or when copying them would produce more than 1,000,000 values or 32 MiB of string data. Before, the snapshot limited only nesting depth, so an object reused across many fields could be copied into far more data than it held before provider validation ran.
