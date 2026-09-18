---
"@opencoredev/email-sdk": patch
---

Fix the SMTP adapter marking every send failure as retryable. Permanent SMTP rejections (5xx replies), authentication and envelope errors, and TLS certificate failures are now classified as non-retryable, while transient failures (4xx replies, connection failures, timeouts, and DNS resolution failures) remain retryable.

SMTP failures that prove the server never accepted the message now also report `delivery: "not_sent"`. Failures that could have happened after the server queued the message continue to report `delivery: "unknown"`.
