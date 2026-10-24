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
  WorkflowEngineOptions,
  WorkflowHooks,
  WorkflowRun,
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

  test("an early timer re-arms the wake from the run's persisted due time", async () => {
    const { engine, scheduler, sender } = setup([linear]);
    const run = await engine.start(linear, ada, { id: "run-1" });

    // A scheduler whose jobs cannot be replaced (Convex) may hold an early wake and nothing else.
    scheduler.cancel("run-1");
    await scheduler.schedule({ runId: "run-1", at: start + 1, revision: run.revision });

    await scheduler.advance("2d", engine);
    expect((await engine.get("run-1"))?.status).toBe("completed");
    expect(sender.deliveries).toHaveLength(2);
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
