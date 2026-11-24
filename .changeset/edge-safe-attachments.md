---
"@opencoredev/email-sdk": patch
---

`@opencoredev/email-sdk/cloudflare` and the other HTTP adapter entry points now bundle for Cloudflare Workers without `nodejs_compat` when called directly (the client's optional telemetry still uses Node built-ins unless `nodejs_compat` is enabled). Attachment encoding uses Web APIs (`btoa`, `TextEncoder`) instead of `Buffer`, and `node:fs/promises` loads only when an attachment is given by `path`. On a runtime without it, a `path` attachment fails with an `EmailValidationError` that says to pass `content` instead. Attachment `content` with `contentEncoding: "base64"` is now decoded strictly: input with wrong padding (`"QUJ="`, `"QQ="`) or non-canonical pad bits (`"QR=="`) throws `EmailValidationError` instead of being silently repaired the way `Buffer.from(value, "base64")` did (whitespace, missing padding, and URL-safe input are still accepted).
