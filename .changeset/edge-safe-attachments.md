---
"@opencoredev/email-sdk": patch
---

`@opencoredev/email-sdk/cloudflare` and the other HTTP adapter entry points now bundle for Cloudflare Workers without `nodejs_compat`. Attachment encoding uses Web APIs (`btoa`, `TextEncoder`) instead of `Buffer`, and `node:fs/promises` loads only when an attachment is given by `path`. On a runtime without it, a `path` attachment fails with an `EmailValidationError` that says to pass `content` instead.
