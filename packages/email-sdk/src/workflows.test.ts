import { describe, expect, spyOn, test } from "bun:test";
import { z } from "zod";

import { EmailAdapterError, EmailValidationError } from "./errors.js";
import { createEmailClient } from "./index.js";
import { memoryAdapter } from "./testing.js";
import type { EmailMessage, EmailSendOptions, EmailSendResult } from "./types.js";
import {
  createManualClock,
  createMemoryWorkflowScheduler,
  createMemoryWorkflowStore,
  createWorkflowEngine,
  defineWorkflow,
  durationToMs,
  WorkflowError,
  WorkflowNonRetryableError,
  workflowIdempotencyKey,
} from "./workflows.js";
import type {
  AnyWorkflowDefinition,
  WorkflowContext,
  WorkflowEngineOptions,
  WorkflowHooks,
  WorkflowJsonValue,
  WorkflowRun,
  ManualClock,
  WorkflowStore,
} from "./workflows.js";

const start = Date.parse("2026-01-01T00:00:00.000Z");

const day = 86_400_000;

type Delivery = { message: EmailMessage; idempotencyKey?: string };

/** Records sends and drops repeats of an idempotency key, like a provider with native idempotency. */
function recordingSender() {
  const deliveries: Delivery[] = [];
  const calls: Delivery[] = [];
  const seenKeys = new Map<string, EmailSendResult>();
  let failures: Error[] = [];

  return {
    deliveries,
    calls,
    failNext(...errors: Error[]) {
      failures = errors;
    },
    async send(message: EmailMessage, options?: EmailSendOptions): Promise<EmailSendResult> {
      calls.push({ message, idempotencyKey: options?.idempotencyKey });
      const failure = failures.shift();

      if (failure) throw failure;

      const key = options?.idempotencyKey;
      const repeat = key === undefined ? undefined : seenKeys.get(key);

      if (repeat) return repeat;

      const result: EmailSendResult = { adapter: "recording", id: `msg_${deliveries.length + 1}` };

      deliveries.push({ message, idempotencyKey: key });

      if (key !== undefined) seenKeys.set(key, result);

      return result;
    },
  };
}

function mail(to: string, subject: string): EmailMessage {
  return { from: "Acme <hello@acme.test>", to, subject, text: subject };
}

type Input = { email: string; name: string };

const linear = defineWorkflow({
  name: "linear",
  run: async (ctx, input: Input) => {
    await ctx.send("welcome", mail(input.email, `Welcome ${input.name}`));
    await ctx.sleep("wait-2d", "2d");
    await ctx.send("tips", mail(input.email, "Tips"));

    return { done: true };
  },
});

const activation = defineWorkflow({
  name: "activation",
  cancelOn: ["unsubscribed"],
  run: async (ctx, input: Input) => {
    await ctx.send("welcome", mail(input.email, "Welcome"));

    const activated = await ctx.waitForEvent<{ plan: string }>("activated", { timeout: "3d" });

    if (activated.status === "received") {
      await ctx.send("tips", mail(input.email, `Tips for ${activated.payload.plan}`));

      return "activated";
    }

    await ctx.send("nudge", mail(input.email, "Need a hand?"));

    return "nudged";
  },
});

function setup(
  workflows: readonly AnyWorkflowDefinition[],
  overrides: Partial<Omit<WorkflowEngineOptions, "workflows">> = {},
) {
  const clock = createManualClock(start);
  const scheduler = createMemoryWorkflowScheduler(clock);
  const store = createMemoryWorkflowStore();
  const sender = recordingSender();
  const engine = createWorkflowEngine({ email: sender, store, scheduler, clock, workflows, ...overrides });

  return { clock, scheduler, store, sender, engine };
}

const ada = { email: "ada@example.test", name: "Ada" };

/** The idempotency keys `ctx.send` uses for these run and step pairs, in order. */
async function keys(...pairs: [runId: string, step: string][]) {
  return await Promise.all(pairs.map(([runId, step]) => workflowIdempotencyKey(runId, step)));
}

const grace = { email: "grace@example.test", name: "Grace" };

describe("workflows: linear sequences and sleeps", () => {
  test("sends, sleeps on a timer, then sends again and completes", async () => {
    const { engine, scheduler, sender } = setup([linear]);

    const run = await engine.start(linear, ada, { id: "run-1" });

    expect(run.status).toBe("waiting");
    expect(run.wait).toEqual({ kind: "sleep", step: "wait-2d", until: start + 2 * day });
    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["Welcome Ada"]);
    expect(scheduler.pending()).toEqual([{ runId: "run-1", at: start + 2 * day, revision: run.revision }]);

    await scheduler.advance("1d", engine);
    expect(sender.deliveries).toHaveLength(1);

    await scheduler.advance("1d", engine);

    const done = await engine.get("run-1");

    expect(done?.status).toBe("completed");
    expect(done?.output).toEqual({ done: true });
    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["Welcome Ada", "Tips"]);
    expect(sender.deliveries.map((d) => d.idempotencyKey)).toEqual(await keys(["run-1", "welcome"], ["run-1", "tips"]));
  });

  test("ignores early, duplicate, and stale timer deliveries", async () => {
    const { engine, sender, clock } = setup([linear]);

    await engine.start(linear, ada, { id: "run-1" });
    await engine.resume("run-1");
    await engine.resume("run-1");
    expect(sender.calls).toHaveLength(1);

    clock.advance("2d");
    await engine.resume("run-1");
    await engine.resume("run-1");
    expect(sender.calls).toHaveLength(2);
    expect((await engine.get("run-1"))?.status).toBe("completed");
  });

  test("resumeDue picks up due runs without a push scheduler", async () => {
    const clock = createManualClock(start);
    const sender = recordingSender();
    const engine = createWorkflowEngine({ email: sender, store: createMemoryWorkflowStore(), clock, workflows: [linear] });

    await engine.start(linear, ada, { id: "run-1" });
    expect(await engine.resumeDue()).toBe(0);

    clock.advance("2d");
    expect(await engine.resumeDue()).toBe(1);
    expect((await engine.get("run-1"))?.status).toBe("completed");
  });

  test("sleepUntil waits for an absolute time", async () => {
    const until = defineWorkflow({
      name: "until",
      run: async (ctx, input: Input) => {
        await ctx.sleepUntil("launch", start + 5 * day);
        await ctx.send("launch-mail", mail(input.email, "We launched"));
      },
    });

    const { engine, scheduler, sender } = setup([until]);

    const run = await engine.start(until, ada, { id: "run-1" });

    expect(scheduler.pending()).toEqual([{ runId: "run-1", at: start + 5 * day, revision: run.revision }]);

    await scheduler.advance("5d", engine);
    expect(sender.deliveries).toHaveLength(1);
  });
});

describe("workflows: events and branching", () => {
  test("waitForEvent takes the received branch when the event arrives in time", async () => {
    const { engine, scheduler, sender } = setup([activation]);

    await engine.start(activation, ada, { id: "run-1", subject: ada.email });
    await scheduler.advance("1d", engine);

    expect(await engine.sendEvent({ name: "activated", subject: ada.email, payload: { plan: "pro" } })).toEqual(["run-1"]);

    const run = await engine.get("run-1");

    expect(run?.status).toBe("completed");
    expect(run?.output).toBe("activated");
    expect(run?.inbox).toEqual([]);
    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["Welcome", "Tips for pro"]);
    expect(scheduler.pending()).toEqual([]);
  });

  test("waitForEvent takes the timeout branch when no event arrives", async () => {
    const { engine, scheduler, sender } = setup([activation]);

    await engine.start(activation, ada, { id: "run-1", subject: ada.email });
    await scheduler.advance("3d", engine);

    const run = await engine.get("run-1");

    expect(run?.output).toBe("nudged");
    expect(run?.journal.activated).toMatchObject({ status: "completed", result: { status: "timed_out" } });
    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["Welcome", "Need a hand?"]);

    // A late event reaches nothing once the run is complete.
    expect(await engine.sendEvent({ name: "activated", runId: "run-1", payload: { plan: "pro" } })).toEqual([]);
  });

  test("an event delivered before the wait step is consumed when the run gets there", async () => {
    const early = defineWorkflow({
      name: "early",
      run: async (ctx, input: Input) => {
        await ctx.sleep("first", "1d");

        const activated = await ctx.waitForEvent("activated", { timeout: "1d" });

        await ctx.send("result", mail(input.email, activated.status));
      },
    });

    const { engine, scheduler, sender } = setup([early]);

    await engine.start(early, ada, { id: "run-1", subject: ada.email });
    await engine.sendEvent({ name: "activated", subject: ada.email });
    expect((await engine.get("run-1"))?.inbox).toHaveLength(1);

    await scheduler.advance("1d", engine);
    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["received"]);
  });

  test("branches on step results with plain control flow", async () => {
    const plans = new Map([
      ["ada@example.test", "pro"],
      ["grace@example.test", "free"],
    ]);

    const branching = defineWorkflow({
      name: "branching",
      run: async (ctx, input: Input) => {
        const plan = await ctx.step("load-plan", () => plans.get(input.email) ?? "free");

        if (plan === "pro") {
          await ctx.send("pro-tips", mail(input.email, "Pro tips"));
        } else {
          await ctx.send("upgrade", mail(input.email, "Upgrade?"));
        }

        return plan;
      },
    });

    const { engine, sender } = setup([branching]);

    await engine.start(branching, ada, { id: "a" });
    await engine.start(branching, grace, { id: "g" });

    expect(sender.deliveries.map((d) => [d.message.to, d.message.subject])).toEqual([
      ["ada@example.test", "Pro tips"],
      ["grace@example.test", "Upgrade?"],
    ]);
  });
});

describe("workflows: cancellation", () => {
  test("a cancelOn event cancels the run mid-wait and clears its timer", async () => {
    const hooks: string[] = [];

    const { engine, scheduler, sender } = setup([activation], {
      hooks: { onRunCanceled: ({ reason }) => void hooks.push(reason) },
    });

    await engine.start(activation, ada, { id: "run-1", subject: ada.email });
    expect(await engine.sendEvent({ name: "unsubscribed", subject: ada.email })).toEqual(["run-1"]);

    const run = await engine.get("run-1");

    expect(run?.status).toBe("canceled");
    expect(run?.cancelReason).toBe("event:unsubscribed");
    expect(scheduler.pending()).toEqual([]);
    expect(hooks).toEqual(["event:unsubscribed"]);

    await scheduler.advance("5d", engine);
    expect(sender.deliveries).toHaveLength(1);
  });

  test("cancel by run id stops a sleeping run", async () => {
    const { engine, scheduler, sender } = setup([linear]);

    await engine.start(linear, ada, { id: "run-1" });
    expect(await engine.cancel("run-1", "user deleted")).toBe(true);
    expect(await engine.cancel("run-1")).toBe(false);

    await scheduler.advance("2d", engine);
    expect(sender.deliveries).toHaveLength(1);
    expect((await engine.get("run-1"))?.cancelReason).toBe("user deleted");
  });

  test("a suppressed recipient cancels the run before the send", async () => {
    const suppressed = new Set<string>();

    const { engine, scheduler, sender } = setup([linear], {
      isSuppressed: (address) => suppressed.has(address),
    });

    await engine.start(linear, ada, { id: "run-1" });
    suppressed.add("ada@example.test");
    await scheduler.advance("2d", engine);

    const run = await engine.get("run-1");

    expect(run?.status).toBe("canceled");
    expect(run?.cancelReason).toBe("suppressed");
    expect(sender.calls).toHaveLength(1);
  });

  test("suppression matches display-name addresses case-insensitively", async () => {
    const named = defineWorkflow({
      name: "named",
      run: async (ctx) => {
        await ctx.send("hello", mail("Ada Lovelace <ADA@example.test>", "Hi"));
      },
    });

    const { engine, sender } = setup([named], { isSuppressed: (address) => address === "ada@example.test" });

    const run = await engine.start(named, null, { id: "run-1" });

    expect(run.status).toBe("canceled");
    expect(sender.calls).toHaveLength(0);
  });
});

/** Wraps a store so a chosen save throws, the way a process crash would cut off the write. */
function crashingStore(inner: WorkflowStore, crashOnSave: number) {
  let saves = 0;

  const store: WorkflowStore = {
    ...inner,
    async save(run, expectedRevision) {
      saves += 1;

      if (saves === crashOnSave) throw new Error("process crashed");

      return await inner.save(run, expectedRevision);
    },
  };

  return store;
}

describe("workflows: idempotency and crash recovery", () => {
  test("a crash after the provider accepted a send re-sends with the same key, and the provider dedupes", async () => {
    const clock = createManualClock(start);
    const memory = createMemoryWorkflowStore();
    const sender = recordingSender();

    // Save 1 renews the lease before the send; save 2 journals "welcome". Crashing there loses the
    // journal entry after the send succeeded.
    const crashed = createWorkflowEngine({ email: sender, store: crashingStore(memory, 2), clock, workflows: [linear] });

    await expect(crashed.start(linear, ada, { id: "run-1" })).rejects.toThrow("process crashed");
    expect((await memory.get("run-1"))?.journal).toEqual({});

    const recovered = createWorkflowEngine({ email: sender, store: memory, clock, workflows: [linear] });

    // The run is held by the crashed worker's lease until it expires.
    expect(await recovered.resumeDue()).toBe(0);
    clock.advance("5m");
    expect(await recovered.resumeDue()).toBe(1);

    expect(sender.calls.map((c) => c.idempotencyKey)).toEqual(await keys(["run-1", "welcome"], ["run-1", "welcome"]));
    expect(sender.deliveries).toHaveLength(1);
    expect((await memory.get("run-1"))?.status).toBe("waiting");
  });

  test("a crash between steps never repeats the completed step", async () => {
    const clock = createManualClock(start);
    const memory = createMemoryWorkflowStore();
    const sender = recordingSender();

    // Save 3 is the sleep's wait. Crashing there leaves "welcome" journaled and no wait recorded.
    const crashed = createWorkflowEngine({ email: sender, store: crashingStore(memory, 3), clock, workflows: [linear] });

    await expect(crashed.start(linear, ada, { id: "run-1" })).rejects.toThrow("process crashed");

    const recovered = createWorkflowEngine({ email: sender, store: memory, clock, workflows: [linear] });

    clock.advance("5m");
    await recovered.resumeDue();
    clock.advance("2d");
    await recovered.resumeDue();

    expect(sender.calls.map((c) => c.idempotencyKey)).toEqual(await keys(["run-1", "welcome"], ["run-1", "tips"]));
    expect((await memory.get("run-1"))?.status).toBe("completed");
  });

  test("starting twice with the same id returns the existing run", async () => {
    const { engine, sender, store } = setup([linear]);

    const first = await engine.start(linear, ada, { id: "onboarding:ada" });
    const second = await engine.start(linear, grace, { id: "onboarding:ada" });

    expect(second.id).toBe(first.id);
    expect(second.input).toEqual(ada);
    expect(sender.deliveries).toHaveLength(1);
    expect(store.runs()).toHaveLength(1);
  });

  test("passes the step idempotency key through a real client to the adapter", async () => {
    const adapter = memoryAdapter();
    const email = createEmailClient({ adapters: [adapter], telemetry: false });
    const clock = createManualClock(start);
    const engine = createWorkflowEngine({ email, store: createMemoryWorkflowStore(), clock, workflows: [linear] });

    const run = await engine.start(linear, ada, { id: "run-1" });

    expect(adapter.raw?.sent).toHaveLength(1);
    expect(run.journal.welcome).toMatchObject({ status: "completed", result: { adapter: "memory", id: "mem_1" } });
  });
});

describe("workflows: retries and failures", () => {
  const flaky = defineWorkflow({
    name: "flaky",
    retry: { maxAttempts: 3, backoff: "1m" },
    run: async (ctx, input: Input) => {
      await ctx.send("welcome", mail(input.email, "Welcome"));
    },
  });

  test("retries a failed send on timers with exponential backoff", async () => {
    const events: string[] = [];

    const hooks: WorkflowHooks = {
      onStepStart: ({ step, attempt }) => void events.push(`start:${step}:${attempt}`),
      onStepError: ({ attempt, willRetry }) => void events.push(`error:${attempt}:${willRetry}`),
      onStepComplete: ({ attempt }) => void events.push(`complete:${attempt}`),
      onRunComplete: () => void events.push("run-complete"),
    };

    const { engine, scheduler, sender } = setup([flaky], { hooks });
    const outage = () => new EmailAdapterError("503", { adapter: "recording", retryable: true });

    sender.failNext(outage(), outage());

    const run = await engine.start(flaky, ada, { id: "run-1" });

    expect(run.wait).toEqual({ kind: "retry", step: "welcome", until: start + 60_000 });

    await scheduler.advance("1m", engine);
    expect((await engine.get("run-1"))?.wait).toEqual({ kind: "retry", step: "welcome", until: start + 3 * 60_000 });

    await scheduler.advance("2m", engine);
    expect((await engine.get("run-1"))?.status).toBe("completed");
    expect(sender.deliveries).toHaveLength(1);
    expect(events).toEqual([
      "start:welcome:1",
      "error:1:true",
      "start:welcome:2",
      "error:2:true",
      "start:welcome:3",
      "complete:3",
      "run-complete",
    ]);
  });

  test("fails the run after the last attempt", async () => {
    const failures: string[] = [];

    const { engine, scheduler, sender } = setup([flaky], {
      hooks: { onRunFailed: ({ error }) => void failures.push(error.message) },
    });

    const outage = () => new Error("timeout");

    sender.failNext(outage(), outage(), outage());
    await engine.start(flaky, ada, { id: "run-1" });
    await scheduler.advance("10m", engine);

    const run = await engine.get("run-1");

    expect(run?.status).toBe("failed");
    expect(run?.error).toEqual({ message: "timeout", step: "welcome" });
    expect(sender.calls).toHaveLength(3);
    expect(failures).toEqual(["timeout"]);
  });

  test("non-retryable errors fail immediately", async () => {
    const { engine, sender } = setup([flaky]);

    sender.failNext(new EmailValidationError("bad address"));

    const run = await engine.start(flaky, ada, { id: "run-1" });

    expect(run.status).toBe("failed");
    expect(sender.calls).toHaveLength(1);

    const stepFails = defineWorkflow({
      name: "step-fails",
      run: async (ctx) => {
        await ctx.step("charge", () => {
          throw new WorkflowNonRetryableError("card declined");
        });
      },
    });

    const second = setup([stepFails]);

    expect((await second.engine.start(stepFails, null)).error).toEqual({ message: "card declined", step: "charge" });
  });

  test("a throwing definition fails the run, and a throwing hook changes nothing", async () => {
    const broken = defineWorkflow({
      name: "broken",
      run: async (ctx, input: Input) => {
        await ctx.send("welcome", mail(input.email, "Welcome"));
        throw new Error("bug in workflow");
      },
    });

    const { engine } = setup([broken], {
      hooks: {
        onStepComplete: () => {
          throw new Error("hook bug");
        },
      },
    });

    const run = await engine.start(broken, ada);

    expect(run.status).toBe("failed");
    expect(run.error).toEqual({ message: "bug in workflow" });
    expect(run.journal.welcome?.status).toBe("completed");
  });

  test("reusing a step name fails the run with duplicate_step", async () => {
    const looped = defineWorkflow({
      name: "looped",
      run: async (ctx, input: Input) => {
        for (const subject of ["a", "b"]) await ctx.send("same-name", mail(input.email, subject));
      },
    });

    const { engine } = setup([looped]);

    const run = await engine.start(looped, ada);

    expect(run.status).toBe("failed");
    expect(run.error?.message).toContain('Step "same-name" ran twice');
  });
});

describe("workflows: isolation and concurrency", () => {
  test("concurrent runs keep separate journals, timers, and events", async () => {
    const { engine, scheduler, sender } = setup([activation]);

    await Promise.all([
      engine.start(activation, ada, { id: "a", subject: ada.email }),
      engine.start(activation, grace, { id: "g", subject: grace.email }),
    ]);

    expect(scheduler.pending().map((t) => t.runId).sort()).toEqual(["a", "g"]);

    await engine.sendEvent({ name: "activated", subject: ada.email, payload: { plan: "team" } });
    await scheduler.advance("3d", engine);

    expect((await engine.get("a"))?.output).toBe("activated");
    expect((await engine.get("g"))?.output).toBe("nudged");
    expect(sender.deliveries.map((d) => d.idempotencyKey)).toEqual(
      await keys(["a", "welcome"], ["g", "welcome"], ["a", "tips"], ["g", "nudge"]),
    );
  });

  test("an event delivered by another engine during a step is merged, not lost", async () => {
    const clock = createManualClock(start);
    const store = createMemoryWorkflowStore();
    const sender = recordingSender();
    let releaseStep: () => void = () => {};

    const stepGate = new Promise<void>((resolve) => {
      releaseStep = resolve;
    });

    let reached: () => void = () => {};

    const stepReached = new Promise<void>((resolve) => {
      reached = resolve;
    });

    const gated = defineWorkflow({
      name: "gated",
      run: async (ctx, input: Input) => {
        await ctx.step("slow", async () => {
          reached();
          await stepGate;

          return 1;
        });

        const activated = await ctx.waitForEvent("activated");

        await ctx.send("after", mail(input.email, activated.status));
      },
    });

    const engineA = createWorkflowEngine({ email: sender, store, clock, workflows: [gated] });
    const engineB = createWorkflowEngine({ email: sender, store, clock, workflows: [gated] });

    const started = engineA.start(gated, ada, { id: "run-1", subject: ada.email });

    await stepReached;
    await engineB.sendEvent({ name: "activated", subject: ada.email });
    releaseStep();

    const run = await started;

    expect(run.status).toBe("completed");
    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["received"]);
  });
});

describe("workflows: definitions, input, and versions", () => {
  test("parses input with a Standard Schema at start", async () => {
    const parsed = defineWorkflow({
      name: "parsed",
      input: z.object({ email: z.email(), name: z.string().trim() }),
      run: async (ctx, input) => {
        await ctx.send("welcome", mail(input.email, `Hi ${input.name}`));
      },
    });

    const { engine, sender } = setup([parsed]);

    await engine.start(parsed, { email: "ada@example.test", name: "  Ada  " });
    expect(sender.deliveries[0]?.message.subject).toBe("Hi Ada");

    const failure = engine.start(parsed, { email: "nope", name: "Ada" });

    await expect(failure).rejects.toBeInstanceOf(WorkflowError);
    await expect(failure).rejects.toMatchObject({ code: "invalid_input" });
  });

  test("in-flight runs keep their version; a missing version leaves the run untouched", async () => {
    const v1 = defineWorkflow({
      name: "drip",
      run: async (ctx, input: Input) => {
        await ctx.sleep("wait", "1d");
        await ctx.send("v1-mail", mail(input.email, "v1"));
      },
    });

    const v2 = defineWorkflow({
      name: "drip",
      version: 2,
      run: async (ctx, input: Input) => {
        await ctx.sleep("wait", "1d");
        await ctx.send("v2-mail", mail(input.email, `v2 seen as ${ctx.version}`));
      },
    });

    const clock = createManualClock(start);
    const store = createMemoryWorkflowStore();
    const sender = recordingSender();
    const old = createWorkflowEngine({ email: sender, store, clock, workflows: [v1] });

    await old.start(v1, ada, { id: "old-run" });
    clock.advance("1d");

    const onlyV2 = createWorkflowEngine({ email: sender, store, clock, workflows: [v2] });
    const before: WorkflowRun | undefined = await store.get("old-run");

    await expect(onlyV2.resume("old-run")).rejects.toMatchObject({ code: "workflow_not_registered" });
    expect(await store.get("old-run")).toEqual(before);

    const both = createWorkflowEngine({ email: sender, store, clock, workflows: [v1, v2] });

    await both.resume("old-run");
    await both.start(v2, grace, { id: "new-run" });
    clock.advance("1d");
    await both.resumeDue();

    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["v1", "v2 seen as 2"]);
  });

  test("rejects invalid definitions and unregistered workflows", async () => {
    expect(() => defineWorkflow({ name: "has space", run: async () => {} })).toThrow(WorkflowError);
    expect(() => defineWorkflow({ name: "zero", version: 0, run: async () => {} })).toThrow(WorkflowError);
    expect(() => createWorkflowEngine({ email: recordingSender(), store: createMemoryWorkflowStore(), workflows: [linear, linear] })).toThrow(
      "registered twice",
    );

    const { engine } = setup([linear]);

    await expect(engine.start(activation, ada)).rejects.toMatchObject({ code: "workflow_not_registered" });
  });

  test("parses durations", () => {
    expect(durationToMs("500ms")).toBe(500);
    expect(durationToMs("30s")).toBe(30_000);
    expect(durationToMs("15m")).toBe(900_000);
    expect(durationToMs("2h")).toBe(7_200_000);
    expect(durationToMs("3d")).toBe(3 * day);
    expect(durationToMs("1w")).toBe(7 * day);
    expect(durationToMs("1.5h")).toBe(5_400_000);
    expect(durationToMs(250)).toBe(250);
    expect(() => durationToMs(-1)).toThrow(WorkflowError);
    expect(() => durationToMs(Number.NaN)).toThrow(WorkflowError);
  });
});

/** A promise the test resolves by hand, plus a signal for when the workflow reached it. */
function gate() {
  let open: () => void = () => {};

  let markReached: () => void = () => {};

  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  const reached = new Promise<void>((resolve) => {
    markReached = resolve;
  });

  return {
    open,
    reached,
    async pass() {
      markReached();
      await opened;
    },
  };
}

/** Settles with "pending" when `promise` has not settled after the current macrotask queue drains. */
async function settledSoon<T>(promise: Promise<T>): Promise<T | "pending"> {
  return await Promise.race([promise, new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"), 20))]);
}

/** Wraps a store so `beforeSave` runs, once, just before the first save that matches. */
function interceptingStore(inner: WorkflowStore, matches: (run: WorkflowRun) => boolean, beforeSave: () => Promise<void>) {
  let fired = false;

  const store: WorkflowStore = {
    ...inner,
    async save(run, expectedRevision) {
      if (!fired && matches(run)) {
        fired = true;
        await beforeSave();
      }

      return await inner.save(run, expectedRevision);
    },
  };

  return store;
}

describe("workflows: multiple workers", () => {
  function sharedWorkers(workflows: readonly AnyWorkflowDefinition[], overrides: Partial<Omit<WorkflowEngineOptions, "workflows">> = {}) {
    const clock = createManualClock(start);
    const store = createMemoryWorkflowStore();
    const sender = recordingSender();
    const options = { email: sender, store, clock, workflows, ...overrides };

    return { clock, store, sender, a: createWorkflowEngine(options), b: createWorkflowEngine(options) };
  }

  test("two engines resuming one due run execute its step once", async () => {
    const slow = gate();
    let calls = 0;

    const sleepy = defineWorkflow({
      name: "sleepy",
      run: async (ctx, input: Input) => {
        await ctx.sleep("wait", "1d");
        await ctx.step("charge", async () => {
          calls += 1;
          await slow.pass();

          return calls;
        });
        await ctx.send("receipt", mail(input.email, "Receipt"));
      },
    });

    const { clock, sender, a, b } = sharedWorkers([sleepy]);

    await a.start(sleepy, ada, { id: "run-1" });
    clock.advance("1d");

    // Both workers read the due run before either writes.
    const first = a.resume("run-1");
    const second = b.resume("run-1");

    await slow.reached;
    expect(await settledSoon(second)).toMatchObject({ status: "running" });
    expect(await b.resumeDue()).toBe(0);
    slow.open();
    await first;

    expect(calls).toBe(1);
    expect(sender.deliveries).toHaveLength(1);
    expect((await a.get("run-1"))?.status).toBe("completed");
  });

  test("a claimed retry keeps its lease while the retried step runs", async () => {
    const slow = gate();
    let calls = 0;

    const retried = defineWorkflow({
      name: "retried",
      retry: { maxAttempts: 3, backoff: "1m" },
      run: async (ctx) => {
        await ctx.step("work", async () => {
          calls += 1;

          if (calls === 1) throw new Error("flaky");

          await slow.pass();

          return calls;
        });
      },
    });

    const { clock, a, b } = sharedWorkers([retried]);

    await a.start(retried, null, { id: "run-1" });
    clock.advance("1m");

    const first = a.resume("run-1");

    await slow.reached;
    expect(await b.resumeDue()).toBe(0);
    slow.open();
    await first;

    expect(calls).toBe(2);
    expect((await a.get("run-1"))?.status).toBe("completed");
  });

  test("a worker whose lease expired cannot commit or send after another worker takes over", async () => {
    const slow = gate();
    let calls = 0;

    const leased = defineWorkflow({
      name: "leased",
      run: async (ctx, input: Input) => {
        const attempt = await ctx.step("work", async () => {
          calls += 1;

          if (calls === 1) await slow.pass();

          return calls;
        });

        await ctx.send("done", mail(input.email, `attempt ${attempt}`));
      },
    });

    const { clock, sender, a, b } = sharedWorkers([leased], { leaseDuration: "1m" });

    const stale = a.start(leased, ada, { id: "run-1" });

    await slow.reached;
    clock.advance("2m");
    expect((await b.resume("run-1"))?.status).toBe("completed");

    slow.open();
    await stale;

    const run = await a.get("run-1");

    expect(run?.journal.work).toMatchObject({ status: "completed", result: 2 });
    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["attempt 2"]);
  });

  test("a long step renews its lease, so no other worker claims the run meanwhile", async () => {
    const slow = gate();

    const long = defineWorkflow({
      name: "long",
      run: async (ctx) => {
        await ctx.step("work", async () => {
          await slow.pass();

          return 1;
        });
      },
    });

    const { clock, store, a, b } = sharedWorkers([long], { leaseDuration: "90ms" });
    const started = a.start(long, null, { id: "run-1" });

    await slow.reached;

    const firstLease = (await store.get("run-1"))?.lease?.until ?? 0;

    clock.advance("60ms");

    // Wait, bounded, for the heartbeat (every lease/3 of real time) to push the lease forward.
    for (let tries = 0; tries < 200 && ((await store.get("run-1"))?.lease?.until ?? 0) <= firstLease; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    clock.advance("60ms");
    expect(clock.now()).toBeGreaterThan(firstLease);
    expect(await b.resumeDue()).toBe(0);

    slow.open();
    expect((await started).status).toBe("completed");
  });

  test("an event delivered between the inbox check and saving the wait is consumed, not stranded", async () => {
    const clock = createManualClock(start);
    const memory = createMemoryWorkflowStore();
    const sender = recordingSender();

    const waiter = defineWorkflow({
      name: "waiter",
      run: async (ctx, input: Input) => {
        const activated = await ctx.waitForEvent("activated");

        await ctx.send("after", mail(input.email, activated.status));
      },
    });

    const other = createWorkflowEngine({ email: sender, store: memory, clock, workflows: [waiter] });

    const store = interceptingStore(
      memory,
      (run) => run.wait?.kind === "event",
      async () => {
        await other.sendEvent({ name: "activated", runId: "run-1" });
      },
    );

    const engine = createWorkflowEngine({ email: sender, store, clock, workflows: [waiter] });
    const run = await engine.start(waiter, ada, { id: "run-1" });

    expect(run.status).toBe("completed");
    expect(run.inbox).toEqual([]);
    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["received"]);
  });

  test("cancel returns at once while a step is blocked, and no later effect runs", async () => {
    const slow = gate();

    const blocked = defineWorkflow({
      name: "blocked",
      run: async (ctx, input: Input) => {
        await ctx.step("slow", async () => {
          await slow.pass();

          return 1;
        });
        await ctx.send("follow-up", mail(input.email, "Follow-up"));
      },
    });

    const { sender, a, b } = sharedWorkers([blocked]);
    const started = a.start(blocked, ada, { id: "run-1" });

    await slow.reached;
    expect(await settledSoon(a.cancel("run-1", "user deleted"))).toBe(true);
    expect(await settledSoon(b.cancel("run-1"))).toBe(false);

    slow.open();

    const run = await started;

    expect(run.status).toBe("canceled");
    expect(run.cancelReason).toBe("user deleted");
    expect(sender.calls).toHaveLength(0);
  });

  test("a cancelOn event from another engine stops the run before its next send", async () => {
    const slow = gate();

    const blocked = defineWorkflow({
      name: "blocked-event",
      cancelOn: ["unsubscribed"],
      run: async (ctx, input: Input) => {
        await ctx.step("slow", async () => {
          await slow.pass();

          return 1;
        });
        await ctx.send("follow-up", mail(input.email, "Follow-up"));
      },
    });

    const { sender, a, b } = sharedWorkers([blocked]);
    const started = a.start(blocked, ada, { id: "run-1", subject: ada.email });

    await slow.reached;
    expect(await settledSoon(b.sendEvent({ name: "unsubscribed", subject: ada.email }))).toEqual(["run-1"]);
    slow.open();

    expect((await started).cancelReason).toBe("event:unsubscribed");
    expect(sender.calls).toHaveLength(0);
  });

  test("a cancel while onStepStart runs stops the send it announced", async () => {
    const hook = gate();

    const hooked = defineWorkflow({
      name: "hooked",
      run: async (ctx, input: Input) => {
        await ctx.send("welcome", mail(input.email, "Welcome"));
      },
    });

    const { sender, a, b } = sharedWorkers([hooked], { hooks: { onStepStart: () => hook.pass() } });
    const started = a.start(hooked, ada, { id: "run-1" });

    await hook.reached;
    expect(await b.cancel("run-1")).toBe(true);
    hook.open();

    expect((await started).status).toBe("canceled");
    expect(sender.calls).toHaveLength(0);
  });

  test("the heartbeat stops once a renewal finds the run canceled, while the step still hangs", async () => {
    const hung = gate();

    const stuck = defineWorkflow({
      name: "stuck",
      run: async (ctx) => {
        await ctx.step("hang", async () => {
          await hung.pass();

          return 1;
        });
      },
    });

    const intervals = spyOn(globalThis, "setInterval");
    const cleared = spyOn(globalThis, "clearInterval");

    try {
      const { a, b } = sharedWorkers([stuck], { leaseDuration: "30ms" });
      const started = a.start(stuck, null, { id: "run-1" });

      await hung.reached;

      const heartbeat = intervals.mock.results.at(-1)?.value;

      expect(heartbeat).toBeDefined();
      expect(await b.cancel("run-1")).toBe(true);

      // Bounded wait (real time) for the next beat to see the cancellation and stop the timer.
      for (let tries = 0; tries < 100 && !cleared.mock.calls.some(([id]) => id === heartbeat); tries += 1) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      expect(cleared.mock.calls.some(([id]) => id === heartbeat)).toBe(true);

      hung.open();
      expect((await started).status).toBe("canceled");
    } finally {
      intervals.mockRestore();
      cleared.mockRestore();
    }
  });
});

describe("workflows: timers", () => {
  test("a stale wake scheduled by a superseded wait does not replace the newer one", async () => {
    const clock = createManualClock(start);
    const scheduler = createMemoryWorkflowScheduler(clock);
    const memory = createMemoryWorkflowStore();
    const sender = recordingSender();
    const held = gate();
    let paused = false;

    const replyThenSleep = defineWorkflow({
      name: "reply-then-sleep",
      run: async (ctx, input: Input) => {
        await ctx.waitForEvent("reply", { timeout: 100 });
        await ctx.sleep("later", 1000);
        await ctx.send("done", mail(input.email, "Done"));
      },
    });

    // Persists the event wait, then holds the save's response, so its wake is scheduled late.
    const store: WorkflowStore = {
      ...memory,
      async save(run, expectedRevision) {
        const saved = await memory.save(run, expectedRevision);

        if (!paused && run.wait?.kind === "event") {
          paused = true;
          await held.pass();
        }

        return saved;
      },
    };

    const engine = createWorkflowEngine({ email: sender, store, scheduler, clock, workflows: [replyThenSleep] });
    const started = engine.start(replyThenSleep, ada, { id: "run-1" });

    await held.reached;
    expect(await engine.sendEvent({ name: "reply", runId: "run-1" })).toEqual(["run-1"]);
    expect((await engine.get("run-1"))?.wait).toEqual({ kind: "sleep", step: "later", until: start + 1000 });

    held.open();
    await started;
    expect(scheduler.pending().map((timer) => timer.at)).toEqual([start + 1000]);

    await scheduler.advance(2000, engine);
    expect((await engine.get("run-1"))?.status).toBe("completed");
    expect(sender.deliveries).toHaveLength(1);
  });

  test("an early wake for a waiting run schedules nothing, and the wait's own timer still fires", async () => {
    const { engine, scheduler, sender } = setup([linear]);

    await engine.start(linear, ada, { id: "run-1" });

    const schedule = spyOn(scheduler, "schedule");

    expect(await engine.resume("run-1")).toMatchObject({ status: "waiting" });
    expect(schedule).not.toHaveBeenCalled();

    await scheduler.advance("2d", engine);
    expect((await engine.get("run-1"))?.status).toBe("completed");
    expect(sender.deliveries).toHaveLength(2);
  });

  describe("lease-expiry wakes", () => {
    const hour = 3_600_000;

    /** Hangs the first call of step "charge" until `hung.open()`, as if its worker had died. */
    function stalling(before?: (ctx: WorkflowContext) => Promise<void>) {
      const hung = gate();
      let calls = 0;

      const workflow = defineWorkflow({
        name: "stalling",
        run: async (ctx, input: Input) => {
          await before?.(ctx);

          const attempt = await ctx.step("charge", async () => {
            calls += 1;

            if (calls === 1) await hung.pass();

            return calls;
          });

          await ctx.send("receipt", mail(input.email, `attempt ${attempt}`));
        },
      });

      return { hung, workflow, calls: () => calls };
    }

    function workers(workflow: AnyWorkflowDefinition, clock: ManualClock = createManualClock(start)) {
      const scheduler = createMemoryWorkflowScheduler(clock);
      const store = createMemoryWorkflowStore();
      const sender = recordingSender();
      // An hour-long lease keeps the dead worker's heartbeat (every third of it, in real time) quiet.
      const options: WorkflowEngineOptions = { email: sender, store, scheduler, clock, workflows: [workflow], leaseDuration: "1h" };

      return { clock, scheduler, store, sender, options };
    }

    test("a run whose worker died mid-step is recovered by the scheduler alone, with no resumeDue", async () => {
      const { hung, workflow, calls } = stalling();
      const { scheduler, store, sender, options } = workers(workflow);
      const dead = createWorkflowEngine(options).start(workflow, ada, { id: "run-1" });

      await hung.reached;
      expect(scheduler.pending()).toEqual([{ runId: "run-1", at: start + hour, revision: 0 }]);

      // The first engine is gone. Only the scheduler fires timers, into a second engine.
      expect(await scheduler.advance("2h", createWorkflowEngine(options))).toBe(1);
      expect((await store.get("run-1"))?.status).toBe("completed");
      expect(calls()).toBe(2);
      expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["attempt 2"]);
      expect(scheduler.pending()).toEqual([]);

      hung.open();
      await dead;
      expect((await store.get("run-1"))?.status).toBe("completed");
      expect(sender.deliveries).toHaveLength(1);
    });

    test("a wake that finds the lease renewed re-arms for the new expiry instead of claiming", async () => {
      const clock = createManualClock(start);

      const { hung, workflow, calls } = stalling(async (ctx) => {
        await ctx.step("first", () => {
          clock.advance("40m");

          return 1;
        });
      });

      const { scheduler, store, options } = workers(workflow, clock);
      const dead = createWorkflowEngine(options).start(workflow, ada, { id: "run-1" });
      const second = createWorkflowEngine(options);

      await hung.reached;

      // Saving step "first" 40 minutes in renewed the lease to start + 1h40m.
      const held = await store.get("run-1");

      expect(held?.lease?.until).toBe(start + 100 * 60_000);
      clock.set(start + hour);
      expect(await scheduler.runDue(second)).toBe(1);
      expect(calls()).toBe(1);
      expect(await store.get("run-1")).toMatchObject({ status: "running", lease: held?.lease });
      expect(scheduler.pending()).toEqual([{ runId: "run-1", at: start + 100 * 60_000, revision: held?.revision }]);

      clock.set(start + 100 * 60_000);
      expect(await scheduler.runDue(second)).toBe(1);
      expect((await store.get("run-1"))?.status).toBe("completed");
      expect(calls()).toBe(2);

      hung.open();
      await dead;
    });

    test("a wait saved after the claim replaces the lease-expiry wake", async () => {
      const { engine, scheduler } = setup([linear], { leaseDuration: "1h" });
      const run = await engine.start(linear, ada, { id: "run-1" });

      expect(scheduler.pending()).toEqual([{ runId: "run-1", at: start + 2 * day, revision: run.revision }]);
    });
  });
});

describe("workflows: step and event semantics", () => {
  test("idempotency keys are unambiguous and bounded", async () => {
    const one = defineWorkflow({
      name: "one",
      run: async (ctx, input: { step: string }) => {
        await ctx.send(input.step, mail("ada@example.test", "Hi"));
      },
    });

    const { engine, sender } = setup([one]);

    await engine.start(one, { step: "c" }, { id: "a:b" });
    await engine.start(one, { step: "b:c" }, { id: "a" });
    await engine.start(one, { step: "x".repeat(500) }, { id: "y".repeat(500) });

    const keys = sender.calls.map((c) => c.idempotencyKey ?? "");

    expect(new Set(keys).size).toBe(3);
    expect(keys[0]).toBe(await workflowIdempotencyKey("a:b", "c"));
    expect(keys.every((key) => /^wf_[0-9a-f]{64}$/.test(key))).toBe(true);
  });

  test("null step results and outputs survive replay", async () => {
    const seen: unknown[] = [];

    const nullable = defineWorkflow({
      name: "nullable",
      run: async (ctx) => {
        const found = await ctx.step("lookup", () => null);

        seen.push(found);
        await ctx.sleep("wait", "1d");

        return found;
      },
    });

    const { engine, scheduler } = setup([nullable]);

    await engine.start(nullable, null, { id: "run-1" });
    await scheduler.advance("1d", engine);

    const run = await engine.get("run-1");

    expect(seen).toEqual([null, null]);
    expect(run?.journal.lookup).toMatchObject({ status: "completed", result: null });
    expect(run?.status).toBe("completed");
    expect(run?.output).toBeNull();
  });

  test("an event delivered after the timeout deadline loses to the timeout", async () => {
    const timed = defineWorkflow({
      name: "timed",
      run: async (ctx, input: Input) => {
        const activated = await ctx.waitForEvent("activated", { timeout: "10ms" });

        await ctx.send("result", mail(input.email, activated.status));
      },
    });

    const { engine, clock, sender } = setup([timed]);

    await engine.start(timed, ada, { id: "run-1" });
    clock.advance("11ms");
    await engine.sendEvent({ name: "activated", runId: "run-1" });

    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["timed_out"]);
  });

  test("an event delivered at or before the deadline wins even if the timer fires first", async () => {
    const timed = defineWorkflow({
      name: "timed-ok",
      run: async (ctx, input: Input) => {
        const activated = await ctx.waitForEvent("activated", { timeout: "10ms" });

        await ctx.send("result", mail(input.email, activated.status));
      },
    });

    const { engine, clock, sender } = setup([timed]);

    await engine.start(timed, ada, { id: "run-1" });
    clock.advance("10ms");
    await engine.sendEvent({ name: "activated", runId: "run-1" });
    await engine.resume("run-1");

    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["received"]);
  });
});

describe("workflows: review regressions", () => {
  test("editing a step result or the input does not rewrite the journal", async () => {
    const counted = defineWorkflow({
      name: "counted",
      run: async (ctx, input: { tags: string[] }) => {
        const counter = await ctx.step("counter", () => ({ n: 0 }));

        counter.n += 1;
        input.tags.push("seen");
        await ctx.sleep("wait", "1d");

        return { n: counter.n, tags: input.tags.length };
      },
    });

    const { engine, scheduler } = setup([counted]);

    await engine.start(counted, { tags: [] }, { id: "run-1" });
    await scheduler.advance("1d", engine);

    const run = await engine.get("run-1");

    expect(run?.journal.counter).toMatchObject({ result: { n: 0 } });
    expect(run?.input).toEqual({ tags: [] });
    expect(run?.output).toEqual({ n: 1, tags: 1 });
  });

  test("a definition that throws synchronously fails the run", async () => {
    const sync = defineWorkflow({
      name: "sync",
      run: () => {
        throw new Error("sync bug");
      },
    });

    const { engine } = setup([sync]);

    const run = await engine.start(sync, null, { id: "run-1" });

    expect(run.status).toBe("failed");
    expect(run.error).toEqual({ message: "sync bug" });
    expect(run.lease).toBeUndefined();
  });

  test("a temporary provider failure through a real client is retried, a rejection is not", async () => {
    const sent: EmailMessage[] = [];
    let failures = [new EmailAdapterError("503", { adapter: "flaky", status: 503, retryable: true })];

    const flakyAdapter = {
      ...memoryAdapter("flaky"),
      send: (message: EmailMessage) => {
        const failure = failures.shift();

        if (failure) throw failure;
        sent.push(message);

        return { adapter: "flaky", id: `msg_${sent.length}` };
      },
    };

    const email = createEmailClient({ adapters: [flakyAdapter], telemetry: false, retry: { maxAttempts: 1 } });

    const once = defineWorkflow({
      name: "once",
      run: async (ctx, input: Input) => {
        await ctx.send("welcome", mail(input.email, "Welcome"));
      },
    });

    const { engine, scheduler } = setup([once], { email });

    expect((await engine.start(once, ada, { id: "run-1" })).wait).toMatchObject({ kind: "retry", step: "welcome" });
    await scheduler.advance("1m", engine);
    expect((await engine.get("run-1"))?.status).toBe("completed");
    expect(sent).toHaveLength(1);

    failures = [new EmailAdapterError("400", { adapter: "flaky", status: 400, retryable: false })];
    expect((await engine.start(once, ada, { id: "run-2" })).status).toBe("failed");
  });

  test("an Email SDK error from another bundle is classified by its shape", async () => {
    // A CommonJS consumer gets the root entry's errors from a different copy of the class.
    class ForeignAdapterError extends Error {
      readonly code = "adapter_error";
      readonly retryable = false;

      constructor() {
        super("rejected");
        this.name = "EmailAdapterError";
      }
    }

    class ForeignRouteError extends Error {
      readonly code = "route_error";
      readonly retryable = false;
      readonly failures = [{ code: "adapter_error", retryable: true }];
    }

    const once = defineWorkflow({
      name: "once",
      run: async (ctx, input: Input) => {
        await ctx.send("welcome", mail(input.email, "Welcome"));
      },
    });

    const { engine, sender } = setup([once]);

    sender.failNext(new ForeignAdapterError());
    expect((await engine.start(once, ada, { id: "run-1" })).status).toBe("failed");

    sender.failNext(new ForeignRouteError("all failed"));
    expect((await engine.start(once, ada, { id: "run-2" })).status).toBe("waiting");
  });

  test("invalid durations, dates, retry policies, and values fail the run instead of stranding it", async () => {
    const failed: string[] = [];

    const bad = {
      sleep: async (ctx: WorkflowContext) => await ctx.sleep("nap", -1),
      timeout: async (ctx: WorkflowContext) => {
        await ctx.waitForEvent("go", { timeout: -1 });
      },
      date: async (ctx: WorkflowContext) => await ctx.sleepUntil("later", new Date("not-a-date")),
      retry: async (ctx: WorkflowContext) => {
        await ctx.step("work", () => 1, { retry: { maxAttempts: 0 } });
      },
      infinity: async (ctx: WorkflowContext) => {
        await ctx.step("ratio", () => 1 / 0);
      },
      output: async () => Number.NaN,
    };

    const definitions = Object.entries(bad).map(([name, run]) => defineWorkflow({ name, run }));
    const { engine, clock } = setup(definitions, { hooks: { onRunFailed: ({ run }) => void failed.push(run.workflow) } });

    for (const definition of definitions) {
      const run = await engine.start(definition, null, { id: definition.name });

      expect({ name: definition.name, status: run.status, lease: run.lease }).toEqual({
        name: definition.name,
        status: "failed",
        lease: undefined,
      });
    }

    clock.advance("1h");
    expect(await engine.resumeDue()).toBe(0);
    expect(failed.sort()).toEqual(Object.keys(bad).sort());
  });

  test("a duplicate start returns the existing run without validating its input", async () => {
    const parsed = defineWorkflow({
      name: "parsed",
      input: z.object({ email: z.email() }),
      run: async (ctx, input) => {
        await ctx.sleep("wait", "1d");

        return input.email;
      },
    });

    const { engine } = setup([parsed]);

    const first = await engine.start(parsed, { email: "ada@example.test" }, { id: "onboarding:u1" });

    expect(await engine.start(parsed, { email: "not-an-email" }, { id: "onboarding:u1" })).toEqual(first);
    await expect(engine.start(parsed, { email: "not-an-email" })).rejects.toThrow("Invalid input");
  });

  test("resumeDue({ limit: 0 }) executes nothing", async () => {
    const clock = createManualClock(start);
    const engine = createWorkflowEngine({ email: recordingSender(), store: createMemoryWorkflowStore(), clock, workflows: [linear] });

    await engine.start(linear, ada, { id: "run-1" });
    clock.advance("2d");
    expect(await engine.resumeDue({ limit: 0 })).toBe(0);
    expect((await engine.get("run-1"))?.status).toBe("waiting");
  });

  /** A workflow whose step hangs, for the run ids in `stuck`, until `release` is called. */
  function hangingWorkflow(stuck: readonly string[]) {
    const gate = Promise.withResolvers<void>();
    const entered: string[] = [];

    const workflow = defineWorkflow({
      name: "hanging",
      run: async (ctx, input: Input) => {
        await ctx.sleep("wait", "1d");
        await ctx.step("fetch", async () => {
          entered.push(ctx.runId);

          if (stuck.includes(ctx.runId)) await gate.promise;

          return null;
        });
        await ctx.send("next", mail(input.email, "Next"));
      },
    });

    return { workflow, entered, release: () => gate.resolve() };
  }

  test("one run stuck in a step does not stop resumeDue from running the next due run", async () => {
    const { workflow, release } = hangingWorkflow(["run-1"]);
    const secondDone = Promise.withResolvers<void>();
    const clock = createManualClock(start);
    const sender = recordingSender();

    const engine = createWorkflowEngine({
      email: sender,
      store: createMemoryWorkflowStore(),
      clock,
      workflows: [workflow],
      hooks: { onRunComplete: ({ run }) => void (run.id === "run-2" && secondDone.resolve()) },
    });

    await engine.start(workflow, ada, { id: "run-1" });
    await engine.start(workflow, grace, { id: "run-2" });
    clock.advance("1d");

    const batch = engine.resumeDue();

    expect(await settledSoon(secondDone.promise)).toBeUndefined();
    expect((await engine.get("run-2"))?.status).toBe("completed");
    expect((await engine.get("run-1"))?.status).toBe("running");
    expect(await settledSoon(batch)).toBe("pending");

    release();
    expect(await batch).toBe(2);
    expect(sender.deliveries.map((delivery) => delivery.message.to).sort()).toEqual([ada.email, grace.email]);
  });

  test("resumeDue starts at most `concurrency` runs at once", async () => {
    const { workflow, entered, release } = hangingWorkflow(["run-1", "run-2", "run-3"]);
    const clock = createManualClock(start);
    const engine = createWorkflowEngine({ email: recordingSender(), store: createMemoryWorkflowStore(), clock, workflows: [workflow] });

    for (const id of ["run-1", "run-2", "run-3"]) await engine.start(workflow, ada, { id });

    clock.advance("1d");

    const batch = engine.resumeDue({ concurrency: 2 });

    expect(await settledSoon(batch)).toBe("pending");
    expect(entered).toEqual(["run-1", "run-2"]);

    release();
    expect(await batch).toBe(3);
    expect(entered).toEqual(["run-1", "run-2", "run-3"]);
  });

  test("resumeDue rejects a concurrency that is not a positive integer", async () => {
    const { engine } = setup([linear]);

    for (const concurrency of [0, -1, 1.5, Number.NaN]) {
      await expect(engine.resumeDue({ concurrency })).rejects.toMatchObject({ code: "invalid_definition" });
    }
  });

  test("runs of an unregistered version do not starve later due runs", async () => {
    const v1 = defineWorkflow({ name: "drip", run: async (ctx) => await ctx.sleep("wait", "1d") });
    const v2 = defineWorkflow({ name: "drip", version: 2, run: async (ctx) => await ctx.sleep("wait", "1d") });
    const clock = createManualClock(start);
    const store = createMemoryWorkflowStore();
    const old = createWorkflowEngine({ email: recordingSender(), store, clock, workflows: [v1] });

    for (let index = 0; index < 5; index += 1) await old.start(v1, null, { id: `old-${index}` });

    const current = createWorkflowEngine({ email: recordingSender(), store, clock, workflows: [v2] });

    await current.start(v2, null, { id: "new" });
    clock.advance("1d");

    await expect(current.resumeDue({ limit: 2 })).rejects.toThrow("5 workflow run(s) failed to resume");
    expect((await current.get("new"))?.status).toBe("completed");
    expect((await current.get("old-0"))?.status).toBe("waiting");
  });

  test("concurrent deliveries to one run are all kept", async () => {
    const { engine } = setup([activation]);

    await engine.start(activation, ada, { id: "run-1" });
    await Promise.all(Array.from({ length: 8 }, () => engine.sendEvent({ name: "ping", runId: "run-1" })));

    expect((await engine.get("run-1"))?.inbox).toHaveLength(8);
  });

  test("a write that keeps conflicting throws instead of reporting the run as unreachable", async () => {
    const base = createMemoryWorkflowStore();
    const { engine } = setup([activation], { store: base });

    await engine.start(activation, ada, { id: "run-1" });

    const busy = createWorkflowEngine({
      email: recordingSender(),
      store: { ...base, save: async () => false },
      clock: createManualClock(start),
      workflows: [activation],
    });

    await expect(busy.sendEvent({ name: "ping", runId: "run-1" })).rejects.toMatchObject({
      errors: [expect.objectContaining({ code: "write_conflict" })],
    });
    await expect(busy.cancel("run-1")).rejects.toThrow("write conflict");
  });

  test("one run's slow follow-up does not delay delivery to the subject's other runs", async () => {
    const slow = gate();

    const follow = defineWorkflow({
      name: "follow",
      run: async (ctx, input: { slow: boolean }) => {
        const activated = await ctx.waitForEvent("activated", { timeout: "10ms" });

        if (input.slow) await ctx.step("slow", async () => await slow.pass());

        return activated.status;
      },
    });

    const { engine, clock } = setup([follow]);

    await engine.start(follow, { slow: true }, { id: "a", subject: "s" });
    await engine.start(follow, { slow: false }, { id: "b", subject: "s" });

    const delivery = engine.sendEvent({ name: "activated", subject: "s" });

    await slow.reached;
    clock.advance("1h");

    // Run b finishes while run a is still blocked in its step.
    for (let tick = 0; tick < 100 && (await engine.get("b"))?.status !== "completed"; tick += 1) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    expect((await engine.get("b"))?.output).toBe("received");
    expect((await engine.get("a"))?.status).toBe("running");
    slow.open();
    expect(await delivery).toEqual(["a", "b"]);
    expect((await engine.get("a"))?.output).toBe("received");
  });

  test("a finished execution does not keep its suspended workflow call alive", async () => {
    const refs: WeakRef<object>[] = [];

    const held = defineWorkflow({
      name: "held",
      run: async (ctx) => {
        const local = { big: Array.from({ length: 1_000 }, () => 0) };

        refs.push(new WeakRef(local));
        await ctx.sleep("wait", "1d");
        local.big.length = 0;
      },
    });

    const { engine } = setup([held]);

    for (let index = 0; index < 20; index += 1) await engine.start(held, null, { id: `run-${index}` });

    await new Promise((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    Bun.gc(true);

    // Before the fix all 20 stayed reachable. JSC scans the stack conservatively, so allow a few.
    expect(refs.filter((ref) => ref.deref() !== undefined).length).toBeLessThan(5);
  });
});

describe("workflows: review regressions, round 2", () => {
  test("hooks that edit the run they are given do not change the saved run", async () => {
    const hooks: WorkflowHooks = {
      onStepStart: ({ run }) => {
        run.input = { email: "evil@example.test", name: "Mallory" };
      },
      onStepComplete: ({ run }) => {
        run.journal = {};
      },
      onRunComplete: ({ run }) => {
        run.output = "redacted";
      },
    };

    const { engine, clock, sender } = setup([linear], { hooks });

    await engine.start(linear, ada, { id: "run-1" });
    clock.advance("2d");
    await engine.resume("run-1");

    const run = await engine.get("run-1");

    expect(run?.input).toEqual(ada);
    expect(Object.keys(run?.journal ?? {})).toEqual(["welcome", "wait-2d", "tips"]);
    expect(run?.output).toEqual({ done: true });
    expect(sender.deliveries.map((d) => d.message.to)).toEqual([ada.email, ada.email]);
  });

  test("an event sent before the deadline wins even when the subject lookup ends after it", async () => {
    const base = createMemoryWorkflowStore();
    const clock = createManualClock(start);

    const store: WorkflowStore = {
      ...base,
      async listActiveBySubject(subject) {
        const runs = await base.listActiveBySubject(subject);

        clock.advance("1h");

        return runs;
      },
    };

    const { engine } = setup([activation], { store, clock });

    await engine.start(activation, ada, { id: "run-1", subject: "ada" });
    // The deadline itself still counts as on time; the lookup then takes an hour.
    clock.advance("3d");
    await engine.sendEvent({ name: "activated", subject: "ada", payload: { plan: "pro" } });

    expect((await engine.get("run-1"))?.output).toBe("activated");
  });

  test("a timeout recorded before an earlier event is saved stands, and sendEvent does not list the run", async () => {
    const base = createMemoryWorkflowStore();
    const slowGet = gate();
    let gated = false;

    const store: WorkflowStore = {
      ...base,
      async get(id) {
        if (gated) {
          gated = false;
          await slowGet.pass();
        }

        return await base.get(id);
      },
    };

    const { engine, clock } = setup([activation], { store });

    await engine.start(activation, ada, { id: "run-1" });
    clock.advance("3d");
    gated = true;

    const delivery = engine.sendEvent({ name: "activated", runId: "run-1", payload: { plan: "pro" } });

    await slowGet.reached;
    clock.advance("1ms");
    await engine.resume("run-1");
    slowGet.open();

    // The event was sent at the deadline, but the timeout was saved first and the run finished.
    expect(await delivery).toEqual([]);
    expect((await engine.get("run-1"))?.output).toBe("nudged");
  });

  test("a sparse array is not JSON and fails the run", async () => {
    const seen: WorkflowJsonValue[] = [];

    const sparse = defineWorkflow({
      name: "sparse",
      run: async (ctx) => {
        const picked = await ctx.step("pick", () => {
          const values: WorkflowJsonValue[] = [];

          values[2] = 7;

          return values;
        });

        seen.push(picked);
      },
    });

    const { engine } = setup([sparse]);
    const run = await engine.start(sparse, null, { id: "run-1" });

    expect(run.status).toBe("failed");
    expect(run.error).toMatchObject({ step: "pick" });
    expect(run.error?.message).toContain("must be JSON");
    expect(seen).toEqual([]);
  });

  test("a circular step result or output fails the run once", async () => {
    function circular(): WorkflowJsonValue {
      const node: { [key: string]: WorkflowJsonValue } = {};

      node.self = node;

      return node;
    }

    let calls = 0;

    const cyclicStep = defineWorkflow({
      name: "cyclic-step",
      run: async (ctx) => {
        await ctx.step("build", () => {
          calls += 1;

          return circular();
        });
      },
    });

    const cyclicOutput = defineWorkflow({ name: "cyclic-output", run: async () => circular() });

    const { engine, clock } = setup([cyclicStep, cyclicOutput]);

    for (const definition of [cyclicStep, cyclicOutput]) {
      const run = await engine.start(definition, null, { id: definition.name });

      expect({ name: definition.name, status: run.status, lease: run.lease }).toEqual({
        name: definition.name,
        status: "failed",
        lease: undefined,
      });
    }

    expect(calls).toBe(1);
    clock.advance("1h");
    expect(await engine.resumeDue()).toBe(0);
  });

  test("shared, acyclic references are still JSON", async () => {
    const shared = defineWorkflow({
      name: "shared",
      run: async (ctx) => {
        const leaf = { n: 1 };

        return await ctx.step("pair", () => ({ left: leaf, right: leaf }));
      },
    });

    const { engine } = setup([shared]);

    expect((await engine.start(shared, null, { id: "run-1" })).output).toEqual({ left: { n: 1 }, right: { n: 1 } });
  });
});

describe("workflows: review regressions, round 3", () => {
  test("workflow code sees the saved JSON form of input and step results before and after a wake", async () => {
    type Pair = { left: { n: number }; right: { n: number }; gone?: string | undefined };

    const views: { right: number; stepHasGone: boolean; inputRight: number; inputHasGone: boolean }[] = [];

    const replayed = defineWorkflow({
      name: "replayed",
      run: async (ctx, input: Pair) => {
        const pair = await ctx.step("pair", (): Pair => {
          const leaf = { n: 1 };

          return { left: leaf, right: leaf, gone: undefined };
        });

        pair.left.n = 2;
        input.left.n = 2;
        views.push({ right: pair.right.n, stepHasGone: "gone" in pair, inputRight: input.right.n, inputHasGone: "gone" in input });
        await ctx.sleep("nap", "1h");
      },
    });

    const { engine, clock } = setup([replayed]);
    const leaf = { n: 1 };

    await engine.start(replayed, { left: leaf, right: leaf, gone: undefined }, { id: "run-1" });
    clock.advance("1h");
    await engine.resume("run-1");

    const saved = { right: 1, stepHasGone: false, inputRight: 1, inputHasGone: false };

    expect(views).toEqual([saved, saved]);
    expect((await engine.get("run-1"))?.status).toBe("completed");
  });

  test.each([
    ["without a timeout", undefined],
    ["with a timeout", "1d"],
  ] as const)("run rejecting beside a queued waitForEvent %s fails the run", async (_label, timeout) => {
    const failures: string[] = [];

    const rejected = defineWorkflow({
      name: "rejected",
      run: async (ctx) => {
        await Promise.all([Promise.reject(new Error("sibling broke")), ctx.waitForEvent("go", { timeout })]);
      },
    });

    const { engine, scheduler } = setup([rejected], {
      hooks: { onRunFailed: ({ error }) => void failures.push(error.message) },
    });

    const run = await engine.start(rejected, null, { id: "run-1" });

    expect(run.status).toBe("failed");
    expect(run.error).toEqual({ message: "sibling broke" });
    expect(run.wait).toBeUndefined();
    expect((await engine.get("run-1"))?.status).toBe("failed");
    expect(failures).toEqual(["sibling broke"]);
    expect(scheduler.pending()).toEqual([]);
  });

  test("a step callback that runs another workflow's execution may use that run's ctx", async () => {
    const child = defineWorkflow({
      name: "child",
      run: async (ctx) => await ctx.step("inner", () => "inner done"),
    });

    let childOutput: WorkflowJsonValue | undefined;

    const parent = defineWorkflow({
      name: "parent",
      run: async (ctx) => {
        await ctx.step("spawn", async () => {
          childOutput = (await engine.start(child, null, { id: "child-1" })).output;
        });
      },
    });

    const { engine } = setup([parent, child]);

    expect((await engine.start(parent, null, { id: "parent-1" })).status).toBe("completed");
    expect(childOutput).toBe("inner done");
  });

  test("an unsubscribe saves every run's cancellation before awaiting a slow onRunCanceled hook", async () => {
    const hook = gate();
    let calls = 0;

    const { engine, scheduler, sender } = setup([activation], {
      hooks: {
        onRunCanceled: async () => {
          calls += 1;

          if (calls === 1) await hook.pass();
        },
      },
    });

    await engine.start(activation, ada, { id: "run-a", subject: "s" });
    await engine.start(activation, ada, { id: "run-b", subject: "s" });

    const delivery = engine.sendEvent({ name: "unsubscribed", subject: "s" });

    await hook.reached;

    expect((await engine.get("run-a"))?.status).toBe("canceled");
    expect((await engine.get("run-b"))?.status).toBe("canceled");

    hook.open();
    expect(await delivery).toEqual(["run-a", "run-b"]);
    expect(calls).toBe(2);
    expect(scheduler.pending()).toEqual([]);
    await scheduler.advance("5d", engine);
    expect(sender.deliveries).toHaveLength(2);
  });

  test("start takes the schema's input and stores its parsed output, with defaults filled", async () => {
    const counted = defineWorkflow({
      name: "counted",
      input: z.object({ count: z.string().transform(Number), plan: z.enum(["free", "pro"]).default("free") }),
      run: async (_ctx, input) => input.count + (input.plan === "pro" ? 100 : 0),
    });

    const { engine } = setup([counted]);
    const run = await engine.start(counted, { count: "42" }, { id: "run-1" });

    expect(run.input).toEqual({ count: 42, plan: "free" });
    expect(run.output).toBe(42);
  });

  test("a step named __proto__ fails the run before its callback runs", async () => {
    let calls = 0;

    const proto = defineWorkflow({
      name: "proto",
      run: async (ctx) => {
        await ctx.step("__proto__", () => {
          calls += 1;
        });
      },
    });

    const { engine } = setup([proto]);
    const run = await engine.start(proto, null, { id: "run-1" });

    expect(run.status).toBe("failed");
    expect(run.error?.message).toContain("can't name a step");
    expect(calls).toBe(0);
  });

  test("suppression reads the mailbox, not angle brackets inside a quoted display name", async () => {
    const checked: string[] = [];

    const quoted = defineWorkflow({
      name: "quoted",
      run: async (ctx) => {
        await ctx.send("hello", mail('"Ada <team>" <ADA@example.test>', "Hi"));
      },
    });

    const { engine, sender } = setup([quoted], {
      isSuppressed: (address) => {
        checked.push(address);

        return address === "ada@example.test";
      },
    });

    const run = await engine.start(quoted, null, { id: "run-1" });

    expect(checked).toEqual(["ada@example.test"]);
    expect(run.status).toBe("canceled");
    expect(sender.calls).toHaveLength(0);
  });
});

describe("workflows: review regressions, round 6", () => {
  const isFailed = (run: WorkflowRun) => run.status === "failed";

  /** Engine `a` saves through `aStore`; engine `b` writes straight to the shared memory store. */
  function racingEngines(
    workflows: readonly AnyWorkflowDefinition[],
    aStore: (memory: WorkflowStore) => WorkflowStore,
    bStore: (memory: WorkflowStore) => WorkflowStore = (memory) => memory,
  ) {
    const clock = createManualClock(start);
    const memory = createMemoryWorkflowStore();
    const sender = recordingSender();
    const failures: string[] = [];
    const hooks: WorkflowHooks = { onRunFailed: ({ error }) => void failures.push(error.message) };

    return {
      memory,
      failures,
      a: createWorkflowEngine({ email: sender, store: aStore(memory), clock, workflows, hooks }),
      b: createWorkflowEngine({ email: sender, store: bStore(memory), clock, workflows, hooks }),
    };
  }

  test("a write by another engine before the failure saves still fails a run that rejected beside a wait", async () => {
    const rejected = defineWorkflow({
      name: "rejected",
      run: async (ctx) => {
        await Promise.all([Promise.reject(new Error("sibling broke")), ctx.waitForEvent("go")]);
      },
    });

    let b: ReturnType<typeof createWorkflowEngine> | undefined;

    const engines = racingEngines([rejected], (memory) =>
      interceptingStore(memory, isFailed, async () => {
        await b?.sendEvent({ runId: "run-1", name: "unrelated" });
      }),
    );

    b = engines.b;

    const run = await engines.a.start(rejected, null, { id: "run-1" });

    expect(run.status).toBe("failed");
    expect(run.error).toEqual({ message: "sibling broke" });
    expect(run.inbox.map((event) => event.name)).toEqual(["unrelated"]);
    expect(engines.failures).toEqual(["sibling broke"]);
  });

  test("an event that lands before the failure saves doesn't wake the run that is failing", async () => {
    let calls = 0;

    const rejected = defineWorkflow({
      name: "rejected",
      run: async (ctx) => {
        calls += 1;
        await Promise.all([Promise.reject(new Error("sibling broke")), ctx.waitForEvent("go")]);
      },
    });

    // Engine b saves the event, then waits to resume the run until engine a has finished.
    const resumeGate = gate();
    let delivered = false;
    let delivery: Promise<string[]> | undefined;
    let b: ReturnType<typeof createWorkflowEngine> | undefined;

    const engines = racingEngines(
      [rejected],
      (memory) =>
        interceptingStore(memory, isFailed, async () => {
          delivery = b?.sendEvent({ runId: "run-1", name: "go" });
          await resumeGate.reached;
        }),
      (memory) => ({
        ...memory,
        async save(run, expectedRevision) {
          const saved = await memory.save(run, expectedRevision);

          if (saved && run.inbox.length > 0) delivered = true;

          return saved;
        },
        async get(id) {
          if (delivered) await resumeGate.pass();

          return await memory.get(id);
        },
      }),
    );

    b = engines.b;

    const run = await engines.a.start(rejected, null, { id: "run-1" });

    resumeGate.open();

    expect(await delivery).toEqual(["run-1"]);
    expect(run.status).toBe("failed");
    expect(run.error).toEqual({ message: "sibling broke" });
    expect((await engines.memory.get("run-1"))?.status).toBe("failed");
    expect(calls).toBe(1);
    expect(engines.failures).toEqual(["sibling broke"]);
  });

  test("a run another engine claimed before the failure saves is left to that engine", async () => {
    const held = gate();
    let calls = 0;

    const flaky = defineWorkflow({
      name: "flaky",
      run: async (ctx) => {
        calls += 1;

        if (calls === 1) {
          await Promise.all([Promise.reject(new Error("sibling broke")), ctx.waitForEvent("go")]);
        }

        await ctx.waitForEvent("go");
        await ctx.step("work", async () => await held.pass());

        return "done";
      },
    });

    let delivery: Promise<string[]> | undefined;
    let b: ReturnType<typeof createWorkflowEngine> | undefined;

    const engines = racingEngines([flaky], (memory) =>
      interceptingStore(memory, isFailed, async () => {
        delivery = b?.sendEvent({ runId: "run-1", name: "go" });
        await held.reached;
      }),
    );

    b = engines.b;

    const run = await engines.a.start(flaky, null, { id: "run-1" });

    expect(run.status).toBe("running");
    expect(run.error).toBeUndefined();

    held.open();

    expect(await delivery).toEqual(["run-1"]);

    const finished = await engines.memory.get("run-1");

    expect(finished?.status).toBe("completed");
    expect(finished?.output).toBe("done");
    expect(engines.failures).toEqual([]);
  });

  test("a run another engine claimed and moved on from before the failure saves is left alone", async () => {
    let calls = 0;

    const flaky = defineWorkflow({
      name: "flaky",
      run: async (ctx) => {
        calls += 1;

        if (calls === 1) {
          await Promise.all([Promise.reject(new Error("sibling broke")), ctx.waitForEvent("go")]);
        }

        await ctx.waitForEvent("go");
        await ctx.waitForEvent("later");

        return "done";
      },
    });

    let b: ReturnType<typeof createWorkflowEngine> | undefined;

    const engines = racingEngines([flaky], (memory) =>
      interceptingStore(memory, isFailed, async () => {
        await b?.sendEvent({ runId: "run-1", name: "go" });
      }),
    );

    b = engines.b;

    const run = await engines.a.start(flaky, null, { id: "run-1" });

    expect(calls).toBe(2);
    expect(run.status).toBe("waiting");
    expect(run.wait).toEqual({ kind: "event", step: "later", event: "later" });
    expect(run.error).toBeUndefined();
    expect(engines.failures).toEqual([]);
  });
});

describe("workflows: ctx calls while a step runs", () => {
  type Overlap = (ctx: WorkflowContext, input: Input) => Promise<WorkflowJsonValue | void>;

  const overlapping: [label: string, run: Overlap][] = [
    [
      "inside the callback before its first await",
      async (ctx, input) => {
        await ctx.step("notify", async () => {
          await ctx.send("mail", mail(input.email, "Hi"));
        });
      },
    ],
    [
      "inside the callback after an await",
      async (ctx, input) => {
        await ctx.step("notify", async () => {
          await Promise.resolve();
          await ctx.send("mail", mail(input.email, "Hi"));
        });
      },
    ],
    [
      "inside the callback after a nested await chain",
      async (ctx, input) => {
        const deeper = async () => {
          await Promise.resolve();
          await new Promise((resolve) => setTimeout(resolve, 0));

          return await ctx.send("mail", mail(input.email, "Hi"));
        };

        const outer = async () => {
          await Promise.resolve();

          return await deeper();
        };

        await ctx.step("notify", async () => {
          await outer();
        });
      },
    ],
    [
      "in a setTimeout callback within the step, with the rejection caught",
      async (ctx, input) => {
        await ctx.step(
          "notify",
          async () =>
            await new Promise<number>((resolve) => {
              setTimeout(() => {
                ctx.send("mail", mail(input.email, "Hi")).catch(() => {});
                resolve(1);
              }, 1);
            }),
        );
      },
    ],
    [
      "as a Promise.all sibling of a step",
      async (ctx, input) => {
        await Promise.all([ctx.step("notify", () => 1), ctx.send("mail", mail(input.email, "Hi"))]);
      },
    ],
    [
      "as a sibling the definition catches before going on",
      async (ctx, input) => {
        const results = await Promise.allSettled([ctx.step("notify", () => 1), ctx.sleep("pause", "1d")]);

        await ctx.send("mail", mail(input.email, String(results.length)));
      },
    ],
  ];

  test.each(overlapping)("a ctx call %s fails the run with invalid_definition", async (_label, run) => {
    const overlap = defineWorkflow({ name: "overlap", run });
    const failures: string[] = [];
    const intervals = spyOn(globalThis, "setInterval");
    const cleared = spyOn(globalThis, "clearInterval");

    try {
      const { engine, scheduler, sender } = setup([overlap], {
        leaseDuration: "30ms",
        hooks: { onRunFailed: ({ error }) => void failures.push(error.message) },
      });

      const settled = await Promise.race([
        engine.start(overlap, ada, { id: "run-1" }),
        new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 1_000)),
      ]);

      expect(settled).not.toBe("hung");

      const saved = await engine.get("run-1");

      expect(saved?.status).toBe("failed");
      expect(saved?.error?.message).toContain("was still running. Await ctx.step before calling ctx again");
      expect(saved?.lease).toBeUndefined();
      expect(saved?.wait).toBeUndefined();
      expect(failures).toHaveLength(1);
      expect(sender.calls).toHaveLength(0);
      expect(scheduler.pending()).toEqual([]);

      const heartbeats = intervals.mock.results.map((result) => result.value);
      const stopped = new Set(cleared.mock.calls.map(([id]) => id));

      expect(heartbeats.every((id) => stopped.has(id))).toBe(true);
    } finally {
      intervals.mockRestore();
      cleared.mockRestore();
    }
  });

  test("the error is a WorkflowError with code invalid_definition", async () => {
    let seen: unknown;

    const overlap = defineWorkflow({
      name: "overlap",
      run: async (ctx, input: Input) => {
        await ctx.step("notify", async () => {
          try {
            await ctx.send("mail", mail(input.email, "Hi"));
          } catch (error) {
            seen = error;
          }
        });
      },
    });

    const { engine } = setup([overlap]);

    expect((await engine.start(overlap, ada, { id: "run-1" })).status).toBe("failed");
    expect(seen).toBeInstanceOf(WorkflowError);
    expect(seen instanceof WorkflowError && seen.code).toBe("invalid_definition");
  });

  test("sequential calls around steps, and overlapping calls without a step, still work", async () => {
    const sequential = defineWorkflow({
      name: "sequential",
      run: async (ctx, input: Input) => {
        const count = await ctx.step("count", async () => {
          await Promise.resolve();

          return 1;
        });

        await Promise.all([ctx.send("a", mail(input.email, "A")), ctx.send("b", mail(input.email, "B"))]);

        const doubled = await ctx.step("double", () => count * 2);

        await ctx.sleep("pause", "1d");

        return { count, doubled };
      },
    });

    const { engine, clock, scheduler, sender } = setup([sequential]);

    expect((await engine.start(sequential, ada, { id: "run-1" })).status).toBe("waiting");

    clock.advance(day);
    await scheduler.runDue(engine);

    const run = await engine.get("run-1");

    expect(run?.status).toBe("completed");
    expect(run?.output).toEqual({ count: 1, doubled: 2 });
    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["A", "B"]);
  });
});

