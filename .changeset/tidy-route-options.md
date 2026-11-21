---
"@opencoredev/email-sdk": patch
---

Routing and option fixes:

- A fallback list that repeats an adapter name, such as `fallback: { adapters: ["backup", "backup"] }`, now attempts that adapter once instead of once per entry.
- In `sendMany`, item `retry` and `fallback` options merge one level deep with the method options. An item with `{ retry: { delay } }` used to drop the batch's `retry.maxAttempts`; an item's `fallback.adapters` still replaces the batch list.
- `client.adapters` and the `adapters` map in plugin contexts are now read-only at runtime, not only in their `ReadonlyMap` type. They no longer have `set`, `delete`, or `clear`, so a cast cannot change routing after the client is created. Reads, iteration, and adapters added by `extendClient` work as before; `client.adapters instanceof Map` is now `false`.
