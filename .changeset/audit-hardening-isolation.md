---
"@opencoredev/email-sdk": patch
---

Harden client and adapter input boundaries: isolate plain `metadata`, `message`, error/response snapshots (`accepted`/`rejected`), and attachment byte snapshots across observational hooks (`afterSend`, `onError`, `onRetry`), middleware, retries, fallbacks, and `sendMany` (note: hooks can no longer share mutable state by mutating plain `metadata` objects; wrap shared state in a custom class instance if shared references are required); cap array snapshot lengths and metadata nesting depth; reject CR/LF characters in header names; bind plugin/hook/retry callables via `Function.prototype.bind`; and validate direct `mailgun`/`sendgrid` `sendPersonalized` inputs before network requests.
