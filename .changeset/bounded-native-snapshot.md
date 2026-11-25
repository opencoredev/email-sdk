---
"@opencoredev/email-sdk": patch
---

`native` send options are now rejected with an `EmailValidationError` when they contain a cycle, or when the SDK's copy of them would hold more than 1,000,000 values (array slots, sparse ones included) or more than 32 Mi UTF-16 code units of strings and keys. All adapter entries of one send share the budget. It measures the copied data, not the serialized request size. Before, the snapshot limited only nesting depth, so an object reused across many fields could be copied into far more data than it held before provider validation ran.
