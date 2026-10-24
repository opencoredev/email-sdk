import { describe, expect, test } from "bun:test";
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

const grace = { email: "grace@example.test", name: "Grace" };

describe("workflows: linear sequences and sleeps", () => {
  test("sends, sleeps on a timer, then sends again and completes", async () => {
    const { engine, scheduler, sender } = setup([linear]);

    const run = await engine.start(linear, ada, { id: "run-1" });

    expect(run.status).toBe("waiting");
    expect(run.wait).toEqual({ kind: "sleep", step: "wait-2d", until: start + 2 * day });
    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["Welcome Ada"]);
    expect(scheduler.pending()).toEqual([{ runId: "run-1", at: start + 2 * day }]);

    await scheduler.advance("1d", engine);
    expect(sender.deliveries).toHaveLength(1);

    await scheduler.advance("1d", engine);

    const done = await engine.get("run-1");

    expect(done?.status).toBe("completed");
    expect(done?.output).toEqual({ done: true });
    expect(sender.deliveries.map((d) => d.message.subject)).toEqual(["Welcome Ada", "Tips"]);
    expect(sender.deliveries.map((d) => d.idempotencyKey)).toEqual(["wf:run-1:welcome", "wf:run-1:tips"]);
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

    await engine.start(until, ada, { id: "run-1" });
    expect(scheduler.pending()).toEqual([{ runId: "run-1", at: start + 5 * day }]);

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

    // Save 1 journals "welcome". Crashing there loses the journal entry after the send succeeded.
    const crashed = createWorkflowEngine({ email: sender, store: crashingStore(memory, 1), clock, workflows: [linear] });

    await expect(crashed.start(linear, ada, { id: "run-1" })).rejects.toThrow("process crashed");
    expect((await memory.get("run-1"))?.journal).toEqual({});

    const recovered = createWorkflowEngine({ email: sender, store: memory, clock, workflows: [linear] });

    // The run is held by the crashed worker's lease until it expires.
    expect(await recovered.resumeDue()).toBe(0);
    clock.advance("5m");
    expect(await recovered.resumeDue()).toBe(1);

    expect(sender.calls.map((c) => c.idempotencyKey)).toEqual(["wf:run-1:welcome", "wf:run-1:welcome"]);
    expect(sender.deliveries).toHaveLength(1);
    expect((await memory.get("run-1"))?.status).toBe("waiting");
  });

  test("a crash between steps never repeats the completed step", async () => {
    const clock = createManualClock(start);
    const memory = createMemoryWorkflowStore();
    const sender = recordingSender();

    // Save 2 is the sleep's wait. Crashing there leaves "welcome" journaled and no wait recorded.
    const crashed = createWorkflowEngine({ email: sender, store: crashingStore(memory, 2), clock, workflows: [linear] });

    await expect(crashed.start(linear, ada, { id: "run-1" })).rejects.toThrow("process crashed");

    const recovered = createWorkflowEngine({ email: sender, store: memory, clock, workflows: [linear] });

    clock.advance("5m");
    await recovered.resumeDue();
    clock.advance("2d");
    await recovered.resumeDue();

    expect(sender.calls.map((c) => c.idempotencyKey)).toEqual(["wf:run-1:welcome", "wf:run-1:tips"]);
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
    expect(sender.deliveries.map((d) => d.idempotencyKey)).toEqual([
      "wf:a:welcome",
      "wf:g:welcome",
      "wf:a:tips",
      "wf:g:nudge",
    ]);
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
