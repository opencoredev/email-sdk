---
"@opencoredev/convex-email": minor
---

Add experimental Convex support for Email SDK workflows at `@opencoredev/convex-email/workflows`. A new `workflowRuns` table with revision-checked `workflows:*` functions backs `convexWorkflowStore`, `convexWorkflowScheduler` uses `ctx.scheduler.runAt` for waits, and `convexWorkflowEmail` sends each step through the new `ConvexEmail.sendWorkflowStep` and `workflows:enqueueSend`. That mutation records each send in a new `workflowSends` table, keyed by the step's idempotency key, in the same transaction that queues the email, so a replayed step never queues a second email, even after `cleanupAfterDays` deleted the first. Records are kept while the run is active and for the new `workflowSendRetentionDays` config option (default 30) after it finishes. Ordinary sends are unchanged. Requires `@opencoredev/email-sdk` 3.1 or later.
