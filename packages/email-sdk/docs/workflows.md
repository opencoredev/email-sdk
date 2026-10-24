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
| `ctx.send(name, message, options?)` | `{ adapter, id? }` | idempotency key `wf:<runId>:<name>`; checks suppression first |
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
  revision: number;                // optimistic concurrency
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

`save` with `expectedRevision` is how two workers racing on one run stay safe: the loser's save
fails, it stops executing, and the winner's state stands. The in-memory store also round-trips every
run through `JSON.stringify` so tests catch values a real store would mangle.

### `WorkflowScheduler`

```ts
type WorkflowScheduler = {
  schedule(timer: { runId: string; at: number }): void | Promise<void>;
  cancel(runId: string): void | Promise<void>;
};
```

When a timer fires, the host calls `engine.resume(runId)`. A run waits on at most one thing at a
time, so one timer per run is enough. Timers are hints: `resume` re-reads the run and does nothing if
it is not due yet, already terminal, or waiting on an event. That makes duplicate, late, and spurious
timer deliveries harmless, and lets `cancel` be best-effort.

Without a push scheduler, call `engine.resumeDue()` from a cron. It asks the store for runs whose
wait has passed.

The in-memory scheduler plus a manual clock (`createManualClock`) make tests deterministic: nothing
sleeps for real; `scheduler.advance("2d", engine)` moves the clock and fires due timers in order.

### Execution loop

1. Load the run. Return if terminal, or if it waits on a future time or an event.
2. Call `run(ctx, input)` and race it against a suspend signal.
3. Each `ctx` call checks the journal. A completed entry returns its result. Otherwise:
   - `send` / `step`: fire `onStepStart`, run the side effect, journal the result, save (CAS), fire
     `onStepComplete`. On failure, record the attempt; if attempts remain, set a retry wait and
     suspend, else fail the run.
   - `sleep`: if no wait is set, set `wait = { kind: "sleep", until }`, save, schedule, suspend. If
     the wait has passed, journal completion and continue.
   - `waitForEvent`: consume a matching inbox event if present. Otherwise set an event wait (with
     `until` when a timeout is given) and suspend. On timeout, journal `timed_out`.
4. Suspension leaves the user's `run` promise pending forever instead of throwing, so a user
   `try/catch` around `ctx.sleep` cannot swallow it.
5. When `run` resolves, the run completes and its return value is stored as `output`. When it throws,
   the run fails.

`ctx` calls inside one execution are serialized, so `Promise.all([ctx.send(a), ctx.send(b)])` runs
the steps one after another rather than racing saves.

### Idempotency

Each `ctx.send` passes `idempotencyKey: "wf:<runId>:<stepName>"` to `email.send`. The journal makes
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
- Otherwise the event goes into the run's inbox (capped at 50). A waiting run whose wait matches is
  resumed immediately. A run that has not reached its `waitForEvent` yet consumes the inbox event
  when it gets there, so "user activated before the reminder step" works.
- `engine.cancel(runId, reason)` cancels by id.
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
`workflows:create/get/save/listActiveBySubject/listDue` mutations and queries. The run is stored as
a JSON string plus indexed columns (`runId`, `status`, `subject`, `dueAt`, `revision`), so the
component never depends on the engine's types, and the CAS check in `save` is transactional.

On the app side, `convexWorkflowStore(component, ctx)` adapts those functions to `WorkflowStore`
and parses each stored run with zod at the boundary. `convexWorkflowScheduler(ctx, resumeRef)`
implements timers with `ctx.scheduler.runAt`; `cancel` is a no-op because `resume` already ignores
early or stale timers. `convexWorkflowEmail(component, ctx)` sends through the component's durable
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
