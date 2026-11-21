---
"@opencoredev/email-sdk": patch
---

`zeptomail()` now throws an `EmailValidationError` ("zeptomail token must be a non-empty string.") when `token` is missing or not a string, such as an un-awaited Promise. It used to crash with a bare `TypeError: options.token.startsWith is not a function`. An empty-string token is now rejected the same way, when the adapter is created; before, it built an adapter whose sends failed ZeptoMail's authentication. Valid tokens behave as before.
