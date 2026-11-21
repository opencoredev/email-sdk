---
"@opencoredev/email-sdk": patch
---

Harden client and adapter input boundaries: isolate `metadata`, `message`, and attachment byte snapshots across hooks, middleware, retries, fallbacks, and `sendMany`; cap array snapshot lengths to guard against forged huge-length array proxies; reject CR/LF characters in header names; bind plugin/hook/retry callables via `Function.prototype.bind`; and validate direct `mailgun`/`sendgrid` `sendPersonalized` inputs before network requests.
