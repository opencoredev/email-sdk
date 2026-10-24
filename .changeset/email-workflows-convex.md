---
"@opencoredev/convex-email": minor
---

Add experimental Convex support for Email SDK workflows at `@opencoredev/convex-email/workflows`. A new `workflowRuns` table with revision-checked `workflows:*` functions backs `convexWorkflowStore`, `convexWorkflowScheduler` uses `ctx.scheduler.runAt` for waits, and `convexWorkflowEmail` sends each step through the component queue with its idempotency key. Requires `@opencoredev/email-sdk` 3.1 or later.
