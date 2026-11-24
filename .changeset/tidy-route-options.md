---
"@opencoredev/email-sdk": patch
---

Routing and option fixes:

- A fallback list that repeats an adapter name, such as `fallback: { adapters: ["backup", "backup"] }`, now attempts that adapter once instead of once per entry.
- In `sendMany`, item `retry` and `fallback` options merge one level deep with the method options. An item with `{ retry: { delay } }` used to drop the batch's `retry.maxAttempts`; an item's `fallback.adapters` still replaces the batch list.
