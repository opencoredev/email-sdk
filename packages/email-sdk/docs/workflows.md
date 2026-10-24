# Email workflows (experimental design)

Status: experimental. Linear EML-10. Ships as `@opencoredev/email-sdk/workflows`; the root entry
does not import it.

## Problem

Apps build onboarding drips, trial reminders, and re-engagement sequences out of cron jobs, ad hoc
`sentAt` columns, and hand-rolled "did we already send this?" checks. The common needs are the same
every time:

- send, wait days, send again
- wait for something the user does ("activated"), with a timeout path
- branch on data
- stop when the user unsubscribes, is suppressed, or a cancel event arrives
- never send the same step twice, even after a crash or a re-delivered timer
- survive deploys while runs are in flight

## Two API styles

### A. Declarative builder

```ts
defineWorkflow("onboarding")
  .send("welcome", welcomeEmail)
  .wait("2d")
  .waitForEvent("activated", { timeout: "3d" })
  .branch((ctx) => ctx.event.activated, tipsChain, nudgeChain)
  .cancelOn(["unsubscribed"]);
```

Pros: the whole graph is data, so it can be drawn, diffed, and stored. Resuming is "jump to step
index N", with no user code re-running.

Cons: every new control-flow need (loops, early return, a computed delay, a value one step returns
and a later step reads) becomes a builder method. Types between steps flow through a growing context
generic that gets hard to read. Branches are nested builders, so a real sequence quickly turns into
a tree of closures that reads worse than the code it replaces.

### B. Step function with durable replay (chosen)

```ts
const onboarding = defineWorkflow({
  name: "onboarding",
  cancelOn: ["unsubscribed"],
  run: async (ctx, input: { email: string; name: string }) => {
    await ctx.send("welcome", welcomeEmail(input));
    await ctx.sleep("wait-2d", "2d");

    const activated = await ctx.waitForEvent<{ plan: string }>("activated", { timeout: "3d" });

    if (activated.status === "received") {
      await ctx.send("tips", tipsEmail(input, activated.payload.plan));
    } else {
      await ctx.send("nudge", nudgeEmail(input));
    }
  },
});
```

Every `ctx.*` call takes a stable step name. The engine keeps a journal of completed steps keyed by
that name. Whenever the run wakes (timer, event, retry), the engine calls `run` again from the top;
completed steps return their journaled result without running again, and the first incomplete step
runs for real.

Pros: branching, loops, and early return are plain TypeScript. Values flow between steps with full
inference (`const user = await ctx.step("load", () => loadUser(id))`). This is the model Inngest,
Trigger.dev, Temporal, and Convex Workflow use, so it is familiar.

Cons: code between steps re-runs on every wake, so it must be deterministic. Side effects belong in
`ctx.step` or `ctx.send`. Step names must be unique within a run (the engine throws on a duplicate).

We pick B. The builder's main advantage, a drawable static graph, does not outweigh how poorly it
handles real sequences, and the replay contract is small enough to state in one paragraph of docs.

## Public API

```ts
import {
  createMemoryWorkflowScheduler,
  createMemoryWorkflowStore,
  createWorkflowEngine,
  defineWorkflow,
} from "@opencoredev/email-sdk/workflows";

const engine = createWorkflowEngine({
  email,                    // anything with EmailClient["send"]
  store,                    // WorkflowStore
  scheduler,                // WorkflowScheduler (optional; polling with resumeDue works without it)
  workflows: [onboarding],
  clock,                    // optional { now(): number }, defaults to Date.now
  isSuppressed,             // optional (address) => boolean | Promise<boolean>
  retry: { maxAttempts: 3, backoff: "1m" },
  leaseDuration: "5m",      // optional; how long an execution holds a run
  hooks: { onStepStart, onStepComplete, onStepError, onRunComplete, onRunCanceled, onRunFailed },
});

const run = await engine.start(onboarding, input, { id: `onboarding:${userId}`, subject: userEmail });

await engine.sendEvent({ name: "activated", subject: userEmail, payload: { plan: "pro" } });
await engine.sendEvent({ name: "unsubscribed", subject: userEmail });
await engine.cancel(run.id, "user deleted");
await engine.resume(runId);     // what a scheduler timer calls
await engine.resumeDue();       // polling fallback for crons
```

### Context

| Call | Journaled result | Notes |
| --- | --- | --- |
| `ctx.send(name, message, options?)` | `{ adapter, id? }` | idempotency key `workflowIdempotencyKey(runId, name)`; checks suppression first |
| `ctx.step(name, fn, { retry? })` | `fn`'s JSON result | retried per policy |
| `ctx.sleep(name, duration)` | none | `"30s"`, `"15m"`, `"2h"`, `"3d"`, `"1w"`, or ms |
| `ctx.sleepUntil(name, date)` | none | absolute time |
| `ctx.waitForEvent<T>(name, { event?, timeout? })` | `{ status: "received", payload } \| { status: "timed_out" }` | `event` defaults to `name` |
| `ctx.runId`, `ctx.workflow`, `ctx.version`, `ctx.subject`, `ctx.startedAt` | | stable across replays |

Step results must be JSON values (`WorkflowJsonValue`) because stores persist them. The type
constraint stops a `Date` from being journaled and replayed as a string.

### Input

`input` is optional. Pass a Standard Schema (zod 4, valibot, arktype) to parse input at `start`, the
boundary where it enters the system. The parsed value is stored and replayed; resume never re-parses.
Without a schema, the type of `run`'s second parameter is the input type.

## Engine and persistence

### Run state

```ts
type WorkflowRun = {
  id: string;
  workflow: string;
  version: number;
  status: "running" | "waiting" | "completed" | "failed" | "canceled";
  input: WorkflowJsonValue;
  subject?: string;
  journal: Record<string, WorkflowStepRecord>;
  inbox: WorkflowInboxEvent[];     // delivered, unconsumed events
  wait?: WorkflowWait;             // what the run is blocked on
  output?: WorkflowJsonValue;
  error?: { message: string; step?: string };
  cancelReason?: string;
  lease?: { owner: string; until: number }; // the execution that holds the run
  revision: number;                // optimistic concurrency
  dueAt?: number;                  // lease expiry, wait deadline, or now when runnable
  createdAt: number;
  updatedAt: number;
};
```

The whole run is one JSON document, so a store only needs keyed get, create-if-absent, a
compare-and-set save on `revision`, and two lookups.

### `WorkflowStore`

```ts
type WorkflowStore = {
  get(id: string): Promise<WorkflowRun | undefined>;
  create(run: WorkflowRun): Promise<boolean>;                      // false when the id exists
  save(run: WorkflowRun, expectedRevision: number): Promise<boolean>; // false on conflict
  listActiveBySubject(subject: string): Promise<WorkflowRun[]>;
  listDue(now: number, limit: number): Promise<string[]>;
};
```

`create` returning false makes `start` idempotent: use a deterministic id (`onboarding:${userId}`)
and a repeated signup webhook returns the existing run instead of starting a second drip.

`save` with `expectedRevision` is the only atomic primitive the engine needs. Everything that must
not happen twice is built on it:

- **Claiming.** Before replaying, an execution saves a lease (`{ owner, until }`) with a revision
  check. A run is claimable only when it is active, has no live lease, and its wait has passed or a
  delivered event satisfies it. Of two workers that read the same due run, one claim wins; the other
  sees a conflict, reloads, finds a live lease, and leaves.
- **Renewing.** The owner renews the lease with a revision-checked save before every step's side
  effect, again after `onStepStart` when that hook is set (so no await separates the last ownership
  check from the effect), and on a heartbeat (every third of `leaseDuration`) while the effect runs.
  The heartbeat stops at the first renewal that finds the run canceled, finished, or taken over,
  even if the effect never settles. Every save by
  the owner reloads on conflict and gives up if the fresh run has another owner or is terminal, so a
  stale worker cannot advance or commit the run. The lease is released when the run waits or ends.
- **Other writers.** Event delivery and cancellation never take the lease. They are plain
  revision-checked writes, so they conflict with the owner's next save, which reloads and sees them.

A step can run twice only when its worker stops renewing for a whole lease (crash, hang, or a
blocked event loop) and another worker takes over. For sends the idempotency key covers that case.

The in-memory store also round-trips every run through `JSON.stringify` so tests catch values a real
store would mangle.

### `WorkflowScheduler`

```ts
type WorkflowScheduler = {
  // revision: the run revision whose wait asked for this wake
  schedule(timer: { runId: string; at: number; revision: number }): void | Promise<void>;
  cancel(runId: string): void | Promise<void>;
};
```

When a timer fires, the host calls `engine.resume(runId)`. A run waits on at most one thing at a
time, so one timer per run is enough. Timers are hints: `resume` re-reads the run and does nothing if
it is already terminal or waiting on an event that has not arrived. If the run is not due yet or is
held by a live lease, `resume` schedules a new timer for the run's persisted `dueAt`. That makes
duplicate, late, early, and spurious timer deliveries harmless, and lets `cancel` be best-effort.

A wait's save releases the run before its timer is scheduled, so a newer execution can schedule
its own timer first and the older `schedule` call arrives late. A scheduler that keeps one timer per
run (like the in-memory one) must ignore a timer whose `revision` is lower than the newest one it
holds for that run. A scheduler that keeps every timer as its own job (like Convex) needs nothing
extra: the stale job fires early and re-arms.

Without a push scheduler, call `engine.resumeDue()` from a cron. It asks the store for runs whose
`dueAt` has passed: expired waits, waits a delivered event satisfies, and leases that expired because
their worker crashed.

The in-memory scheduler plus a manual clock (`createManualClock`) make tests deterministic: nothing
sleeps for real; `scheduler.advance("2d", engine)` moves the clock and fires due timers in order.

### Execution loop

1. Load the run. Return unless it is claimable (see above), then claim it with a lease.
2. Call `run(ctx, input)` and race it against a suspend signal.
3. Each `ctx` call checks the journal. A completed entry returns its result. Otherwise:
   - `send` / `step`: renew the lease (this is where a cancellation or a lost lease stops the run),
     fire `onStepStart` and renew again, run the side effect with the heartbeat on, journal the result, save, fire
     `onStepComplete`. On failure, record the attempt; if attempts remain, set a retry wait and
     suspend, else fail the run.
   - `sleep`: if the persisted wait has passed, journal completion and continue. Otherwise save
     `wait = { kind: "sleep", until }`, schedule, suspend.
   - `waitForEvent`: one revision-checked save decides between three outcomes, re-evaluated on the
     fresh run after any conflict: consume the first inbox event with `receivedAt <= until`; journal
     `timed_out` if `until` has passed; or save the event wait and suspend. Because a concurrent
     delivery makes that save conflict, an event can't land between "inbox is empty" and "wait
     saved" and be stranded.
4. Suspension leaves the user's `run` promise pending forever instead of throwing, so a user
   `try/catch` around `ctx.sleep` cannot swallow it.
5. When `run` resolves, the run completes and its return value is stored as `output`. When it throws,
   the run fails.

`ctx` calls inside one execution are serialized, so `Promise.all([ctx.send(a), ctx.send(b)])` runs
the steps one after another rather than racing saves.

### Idempotency

Each `ctx.send` passes `idempotencyKey: workflowIdempotencyKey(runId, stepName)` to `email.send`:
`wf_` plus the SHA-256 hex digest of `JSON.stringify([runId, stepName])`. JSON encoding keeps the
pair unambiguous (run `a:b` step `c` and run `a` step `b:c` used to collide as `wf:a:b:c`), and the
hash keeps the key at 67 characters, inside provider limits such as Resend's 256. The journal makes
replays skip completed sends; the key covers the remaining window, a crash after the provider
accepted the message but before the journal save. On adapters with `idempotency: "native"` (Resend,
Postmark, and others) the provider drops the duplicate; on `message_id` adapters (SMTP) the
`Message-ID` lets the receiving side dedupe; on `"none"` adapters delivery is at least once in that
window. The docs say so.

### Events and cancellation

- `sendEvent({ name, runId? | subject?, payload? })` targets one run or every active run for a
  subject.
- If the event name is in the definition's `cancelOn`, the run is canceled (timers canceled,
  `onRunCanceled` fired, `cancelReason: "event:<name>"`).
- Otherwise the event goes into the run's inbox (capped at 50), stamped with `receivedAt`. Delivery
  never touches the run's wait or its deadline. A waiting run whose wait matches is resumed
  immediately. A run that has not reached its `waitForEvent` yet consumes the inbox event when it
  gets there, so "user activated before the reminder step" works.
- Event versus timeout is decided by persisted timestamps, not by which worker gets there first: an
  event with `receivedAt <= wait.until` wins, a later one loses to the timeout and stays in the
  inbox. `receivedAt` comes from the delivering engine's clock.
- `engine.cancel(runId, reason)` cancels by id. Cancellation (by id, `cancelOn`, or suppression) is a
  revision-checked write of the terminal state and does not wait for a running step. The owner's next
  save sees the canceled run and stops, so no later step or send runs. An effect already in flight,
  such as a provider request, may still complete; its result is discarded.
- `isSuppressed(address)` runs before every send. A suppressed recipient cancels the run with reason
  `suppressed` and no send happens. Wire it to your suppression list or bounce table.

### Retry policy

Defaults: 3 attempts, exponential backoff from 1 minute (1m, 2m, 4m), configurable per engine and
per step. An `EmailSdkError` with `retryable: false` (validation errors, permanent provider
rejections) fails immediately. Retries are timers, not in-process sleeps, so a crash during backoff
loses nothing. The email client's own `retry` option still applies inside each attempt.

### Versioning in-flight runs

A run records its definition's `version` (default `1`). `start` uses the highest registered version
for the name; `resume` uses the run's own version. If that version is no longer registered, `resume`
throws `WorkflowError` with code `workflow_not_registered` and leaves the run untouched, so the fix
is to redeploy with the old definition still registered.

Safe changes without a version bump: adding steps after the run's current position, changing email
content, changing branch conditions for future steps.

Unsafe without a bump: renaming or removing a completed step (the renamed step looks new and runs
again, which for a send means a second email), changing a sleep's duration (already-scheduled waits
keep their old time). The recommended pattern is to bump `version`, keep the old definition
registered until its runs drain, and remove it later. `ctx.version` lets one definition branch on
the run's version when keeping two copies is not worth it.

### Observability

Engine hooks: `onStepStart`, `onStepComplete` (with `durationMs`), `onStepError` (with `willRetry`),
`onRunComplete`, `onRunCanceled`, `onRunFailed`. Hooks are observability only: like the core
client's hooks, a throwing hook is swallowed and never changes run behavior.

## Bundle impact

The workflows code lives in `src/workflows/` and is reachable only through the
`./workflows` subpath export. `src/index.ts` does not import it. Measured on the build output:
`dist/index.js` and `dist/index.cjs` are byte-identical before and after (see the PR for numbers).

## Convex integration

`@opencoredev/convex-email` stores runs in a `workflowRuns` table and exposes
`workflows:create/get/save/listActiveBySubject/listDue` mutations and queries.
`listActiveRunsBySubject` returns one page; `convexWorkflowStore` follows its cursor across queries
so every active run for a subject is returned without one query reading the whole set. The run is stored as
a JSON string plus indexed columns (`runId`, `status`, `subject`, `dueAt`, `revision`), so the
component never depends on the engine's types, and the CAS check in `save` is transactional.

On the app side, `convexWorkflowStore(component, ctx)` adapts those functions to `WorkflowStore`
and parses each stored run with zod at the boundary. `convexWorkflowScheduler(ctx, resumeRef)`
implements timers with `ctx.scheduler.runAt`; `cancel` is a no-op because `resume` already ignores
stale timers and re-arms early ones from `dueAt`. `convexWorkflowEmail(component, ctx)` sends through the component's durable
queue (`enqueue` with the step's idempotency key), so a workflow send gets the component's retries,
fallback, and webhook status tracking.

The engine runs in a Convex action (the user's `run` function is app code the component cannot
call). A typical app defines one internal action, `resumeWorkflow({ runId })`, that builds the
engine and calls `engine.resume`, and passes its reference to the scheduler.

## Not in scope (yet)

- Parallel branches (`Promise.all` runs steps serially today).
- Child workflows and `ctx.invoke`.
- A run history table beyond the journal.
- Event buffering for runs that have not started.
- Visual editor or graph export.
