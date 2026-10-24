---
"@opencoredev/email-sdk": minor
---

Add experimental durable email workflows at `@opencoredev/email-sdk/workflows`. Define drips and onboarding sequences as step functions with `ctx.send`, `ctx.sleep`, `ctx.waitForEvent` (with timeouts), and `ctx.step`; branch with plain TypeScript; cancel runs by id, by `cancelOn` events such as `unsubscribed`, or through an `isSuppressed` check. Each send carries a stable `wf:<runId>:<step>` idempotency key, completed steps are journaled so replays never repeat them, and failed steps retry on timers. Storage and timers plug in through small `WorkflowStore` and `WorkflowScheduler` interfaces, with in-memory versions and a manual clock for tests. The package root does not import the new entry, so the main bundle is unchanged.
