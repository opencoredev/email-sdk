---
"@opencoredev/email-sdk": patch
---

`zeptomail()` now throws an `EmailValidationError` ("zeptomail token must be a non-empty string.") when `token` is missing, empty, or not a string, such as an un-awaited Promise. It used to crash with a bare `TypeError: options.token.startsWith is not a function`. Valid tokens behave as before.
