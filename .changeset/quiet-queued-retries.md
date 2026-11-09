---
"@opencoredev/convex-email": patch
---

Queued retries no longer fall back to another provider after an earlier attempt may have sent the email. The email records the first adapter whose outcome was unknown in the new `unknownDeliveryAdapter` field, and every later attempt, including a manual `retry`, goes only to that adapter with the same idempotency key. An outcome counts as unknown after a timeout, 5xx or network error, after any error once a request went out (such as failing to record a send the provider accepted), and when a stalled worker is recovered. Before, each queued attempt started again at the primary adapter, so a 503 followed by a 401 on the next attempt could send a second copy through the fallback adapter. The pin uses the adapter's registered name, so an adapter registered under another provider's name never receives the retry. Manual retries of emails that failed with an unknown outcome before this change are pinned the same way; if the stored adapter name matches more than one registered adapter, `retry` returns `false` instead of guessing.

The worker also records each provider attempt before the request goes out, and does not send if it cannot. The new `dispatchedAdapter` field shows the adapter the current attempt last reached.
