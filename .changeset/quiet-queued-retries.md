---
"@opencoredev/convex-email": patch
---

Queued retries no longer fall back to another provider after an earlier attempt may have sent the email. When an attempt ends with an unknown outcome (a timeout, 5xx or network error, or a worker that stopped mid-send), the email records that adapter in the new `unknownDeliveryAdapter` field, and every later attempt, including a manual `retry`, goes only to it with the same idempotency key. Before, each queued attempt started again at the primary adapter, so a 503 followed by a 401 on the next attempt could send a second copy through the fallback adapter.
