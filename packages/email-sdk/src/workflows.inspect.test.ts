import { describe, expect, test } from "bun:test";

import type { EmailMessage } from "./types.js";
import {
  createManualClock,
  createMemoryWorkflowScheduler,
  createMemoryWorkflowStore,
  createWorkflowEngine,
  defineWorkflow,
  describeRun,
  formatWorkflowGraph,
  inspectWorkflow,
  toMermaid,
} from "./workflows.js";
import type { WorkflowContext, WorkflowInspectGraph, WorkflowInspectNode } from "./workflows.js";

type OnboardingInput = { userId: string; email: string; name: string };

const from = "Acme <hello@acme.com>";

function message(to: string, subject: string, text: string): EmailMessage {
  return { from, to, subject, text, html: `<p>${text}</p>` };
}

// The examples/onboarding-drip workflow, imported from source instead of the built package.
const onboarding = defineWorkflow({
  name: "onboarding",
  cancelOn: ["unsubscribed"],
  run: async (ctx, input: OnboardingInput) => {
    await ctx.send("welcome", message(input.email, `Welcome, ${input.name}`, "Your account is ready."));
    await ctx.sleep("before-tip", "2d");
    await ctx.send("tip", message(input.email, "One tip to get started", "Invite a teammate."));

    const activated = await ctx.waitForEvent<{ plan: string }>("activated", { timeout: "3d" });

    if (activated.status === "received") {
      await ctx.send("activated-mail", message(input.email, "You're all set", `Enjoy the ${activated.payload.plan} plan.`));

      return { outcome: "activated" };
    }

    await ctx.send("nudge", message(input.email, "Need a hand?", "Reply to this email and we'll help."));

    return { outcome: "nudged" };
  },
});

const ada = { userId: "u_1", email: "ada@example.com", name: "Ada" };

function nodeById(graph: WorkflowInspectGraph, id: string): WorkflowInspectNode {
  const node = graph.nodes.find((item) => item.id === id);

  if (!node) throw new Error(`No node ${id}`);

  return node;
}

describe("inspectWorkflow", () => {
  test("maps the onboarding drip into a graph with both event branches", async () => {
    const graph = await inspectWorkflow(onboarding, { input: ada, events: { activated: { plan: "pro" } } });

    expect(graph.workflow).toBe("onboarding");
    expect(graph.version).toBe(1);
    expect(graph.cancelOn).toEqual(["unsubscribed"]);
    expect(graph.truncated).toBe(false);

    expect(graph.nodes.map((node) => [node.id, node.kind, node.offsetMs])).toEqual([
      ["$trigger", "trigger", 0],
      ["welcome", "send", 0],
      ["before-tip", "sleep", 0],
      ["tip", "send", 172_800_000],
      ["activated", "waitForEvent", 172_800_000],
      ["activated:received/activated-mail", "send", 172_800_000],
      ["activated:received/$end", "end", 172_800_000],
      ["activated:timeout/nudge", "send", 432_000_000],
      ["activated:timeout/$end", "end", 432_000_000],
    ]);

    expect(graph.edges).toEqual([
      { from: "$trigger", to: "welcome" },
      { from: "welcome", to: "before-tip" },
      { from: "before-tip", to: "tip" },
      { from: "tip", to: "activated" },
      { from: "activated", to: "activated:received/activated-mail", branch: "received" },
      { from: "activated:received/activated-mail", to: "activated:received/$end" },
      { from: "activated", to: "activated:timeout/nudge", branch: "timeout" },
      { from: "activated:timeout/nudge", to: "activated:timeout/$end" },
    ]);

    expect(graph.paths.map((path) => [path.choices, path.outcome, path.durationMs])).toEqual([
      [[{ step: "activated", branch: "received" }], { status: "completed", output: { outcome: "activated" } }, 172_800_000],
      [[{ step: "activated", branch: "timeout" }], { status: "completed", output: { outcome: "nudged" } }, 432_000_000],
    ]);
  });

  test("records the rendered email, delays, and the event wait", async () => {
    const graph = await inspectWorkflow(onboarding, { input: ada, events: { activated: { plan: "pro" } } });

    expect(nodeById(graph, "welcome")).toMatchObject({
      kind: "send",
      step: "welcome",
      email: {
        from,
        to: ["ada@example.com"],
        cc: [],
        subject: "Welcome, Ada",
        text: "Your account is ready.",
        html: "<p>Your account is ready.</p>",
      },
    });

    expect(nodeById(graph, "activated:received/activated-mail")).toMatchObject({
      email: { subject: "You're all set", text: "Enjoy the pro plan." },
    });

    expect(nodeById(graph, "before-tip")).toMatchObject({ delay: { kind: "duration", ms: 172_800_000 }, label: "Wait 2d" });
    expect(nodeById(graph, "activated")).toMatchObject({ event: "activated", timeoutMs: 259_200_000 });
  });

  test("serializes to JSON unchanged", async () => {
    const graph = await inspectWorkflow(onboarding, { input: ada, events: { activated: { plan: "pro" } } });

    expect(JSON.parse(JSON.stringify(graph))).toEqual(graph);
  });

  test("renders mermaid with branch labels and the cancel note", async () => {
    const graph = await inspectWorkflow(onboarding, { input: ada, events: { activated: { plan: "pro" } } });

    expect(toMermaid(graph)).toBe(
      [
        "flowchart TD",
        '  n0(["Start onboarding v1"])',
        '  n1["send welcome<br/>Welcome, Ada → ada@example.com"]',
        '  n2{{"sleep before-tip<br/>Wait 2d"}}',
        '  n3["send tip<br/>One tip to get started → ada@example.com"]',
        '  n4{"waitForEvent activated<br/>Wait for #quot;activated#quot; (timeout 3d)"}',
        '  n5["send activated-mail<br/>You\'re all set → ada@example.com"]',
        '  n6(("Completed with {#quot;outcome#quot;:#quot;activated#quot;}"))',
        '  n7["send nudge<br/>Need a hand? → ada@example.com"]',
        '  n8(("Completed with {#quot;outcome#quot;:#quot;nudged#quot;}"))',
        "  n0 --> n1",
        "  n1 --> n2",
        "  n2 --> n3",
        "  n3 --> n4",
        "  n4 -->|received| n5",
        "  n5 --> n6",
        "  n4 -->|timeout| n7",
        "  n7 --> n8",
        '  cancel>"Cancels on: unsubscribed"]',
      ].join("\n"),
    );
  });

  test("formats a text outline per path", async () => {
    const graph = await inspectWorkflow(onboarding, { input: ada, events: { activated: { plan: "pro" } } });
    const text = formatWorkflowGraph(graph);

    expect(text).toContain("onboarding v1 (cancels on: unsubscribed)");
    expect(text).toContain("path-1 [activated received]: completed after 2d");
    expect(text).toContain("path-2 [activated timeout]: completed after 5d");
    expect(text).toMatch(/\+5d\s+send nudge\s+Need a hand\? → ada@example.com/);
  });

  test("uses step mocks without running the callback, and marks missing ones unknown", async () => {
    let called = false;

    const workflow = defineWorkflow({
      name: "steps",
      run: async (ctx) => {
        const plan = await ctx.step("load-plan", () => {
          called = true;

          return "free";
        });

        await ctx.step("audit", () => null);

        return { plan: plan ?? "none" };
      },
    });

    const graph = await inspectWorkflow(workflow, { input: null, steps: { "load-plan": "pro" } });

    expect(called).toBe(false);
    expect(nodeById(graph, "load-plan")).toMatchObject({ kind: "step", result: { status: "mocked", value: "pro" } });
    expect(nodeById(graph, "audit")).toMatchObject({ kind: "step", result: { status: "unknown" }, label: "result unknown" });
    expect(graph.paths[0]?.outcome).toEqual({ status: "completed", output: { plan: "pro" } });
  });

  test("caps the number of paths and reports truncation", async () => {
    const workflow = defineWorkflow({
      name: "many-waits",
      run: async (ctx) => {
        for (let index = 0; index < 4; index += 1) {
          await ctx.waitForEvent(`event-${index}`, { timeout: "1d" });
        }
      },
    });

    const full = await inspectWorkflow(workflow, { input: null });
    const capped = await inspectWorkflow(workflow, { input: null, maxPaths: 3 });

    expect(full.paths).toHaveLength(16);
    expect(full.truncated).toBe(false);
    expect(capped.paths).toHaveLength(3);
    expect(capped.truncated).toBe(true);
    expect(toMermaid(capped)).toContain("%% truncated: maxPaths=3, maxDepth=100");
  });

  test("caps the depth of an unbounded loop", async () => {
    const workflow = defineWorkflow({
      name: "forever",
      run: async (ctx) => {
        for (let index = 0; ; index += 1) {
          await ctx.sleep(`tick-${index}`, "1h");
        }
      },
    });

    const graph = await inspectWorkflow(workflow, { input: null, maxDepth: 5 });

    expect(graph.truncated).toBe(true);
    expect(graph.nodes.filter((node) => node.kind === "sleep")).toHaveLength(5);
    expect(graph.paths[0]?.outcome).toEqual({ status: "truncated", reason: "More than 5 ctx calls in one path." });
  });

  test("an untimed wait does not fork, and a thrown error ends the path as failed", async () => {
    const workflow = defineWorkflow({
      name: "untimed",
      run: async (ctx) => {
        await ctx.waitForEvent("confirmed");
        await ctx.sleepUntil("later", 3_600_000);
        throw new Error("boom");
      },
    });

    const graph = await inspectWorkflow(workflow, { input: null });

    expect(graph.paths).toHaveLength(1);
    expect(nodeById(graph, "later")).toMatchObject({ delay: { kind: "until", at: "1970-01-01T01:00:00.000Z", ms: 3_600_000 } });
    expect(graph.paths[0]?.outcome).toEqual({ status: "failed", error: 'boom (note: "confirmed" had no sample payload; pass one in events)' });
  });

  test("reports a duplicate step name as a failed path", async () => {
    const workflow = defineWorkflow({
      name: "dupes",
      run: async (ctx) => {
        await ctx.sleep("pause", "1m");
        await ctx.sleep("pause", "1m");
      },
    });

    const graph = await inspectWorkflow(workflow, { input: null });

    expect(graph.paths[0]?.outcome).toMatchObject({ status: "failed" });
  });

  test.each(["trigger", "end", "$trigger", "$end", "a:received/b"])(
    "a step named %p gets its own node, apart from the trigger and end nodes",
    async (name) => {
      const workflow = defineWorkflow({
        name: "collision",
        run: async (ctx) => {
          await ctx.send(name, message("c@d.test", "Hello", "Hi"));
        },
      });

      const graph = await inspectWorkflow(workflow, { input: null });
      const ids = graph.nodes.map((node) => node.id);

      expect(graph.nodes.map((node) => node.kind)).toEqual(["trigger", "send", "end"]);
      expect(new Set(ids).size).toBe(3);
      expect(graph.nodes[1]).toMatchObject({ kind: "send", step: name });
      expect(graph.edges.every((edge) => edge.from !== edge.to)).toBe(true);
      expect(graph.paths[0]?.nodes).toEqual(ids);
    },
  );

  test("branch prefixes can't make two different nodes share an id", async () => {
    const workflow = defineWorkflow({
      name: "prefixes",
      run: async (ctx) => {
        await ctx.sleep("a:received/end", "1m");

        const first = await ctx.waitForEvent("a", { timeout: "1d" });

        if (first.status === "received") return;

        await ctx.sleep("received/end", "1m");
      },
    });

    const graph = await inspectWorkflow(workflow, { input: null });
    const ids = graph.nodes.map((node) => node.id);

    expect(new Set(ids).size).toBe(ids.length);
    expect(graph.nodes.map((node) => node.kind)).toEqual(["trigger", "sleep", "waitForEvent", "end", "sleep", "end"]);
    expect(graph.edges.every((edge) => edge.from !== edge.to)).toBe(true);
  });

  test("rejects the step name the engine reserves, as the engine does", async () => {
    const workflow = defineWorkflow({
      name: "reserved",
      run: async (ctx) => {
        await ctx.send("__proto__", message("c@d.test", "Hello", "Hi"));
      },
    });

    const graph = await inspectWorkflow(workflow, { input: null });

    expect(graph.paths[0]?.outcome).toMatchObject({ status: "failed", error: expect.stringContaining('"__proto__" can\'t name a step') });
    expect(graph.nodes.map((node) => node.kind)).toEqual(["trigger", "end"]);
  });

  test("keeps every node on one line in the text outline", async () => {
    const workflow = defineWorkflow({
      name: "lines",
      cancelOn: ["a|b\n\"<x>"],
      run: async (ctx) => {
        await ctx.send("quotes\nnext|<x>", message("c@d.test", "Hi\r\nspoof|\"<tag>\u001b[31m", "Hi"));
        await ctx.waitForEvent("wait\nhere", { timeout: "1d" });
        throw new Error("bad\nthing");
      },
    });

    const graph = await inspectWorkflow(workflow, { input: null });
    const text = formatWorkflowGraph(graph);

    expect(text).not.toContain("\r");
    expect(text).not.toContain("\u001b");

    for (const line of text.split("\n")) {
      expect(line === "" || /^(lines|path-|  \+|Truncated)/.test(line)).toBe(true);
    }

    expect(text).toContain('lines v1 (cancels on: a|b\\n"<x>)');
    expect(text).toContain('send quotes\\nnext|<x>');
    expect(text).toContain('Hi\\r\\nspoof|"<tag>\\u001b[31m → c@d.test');
    expect(text).toContain("[wait\\nhere received]");
    expect(text).toContain("Failed: bad\\nthing");
    expect(toMermaid(graph).split("\n").every((line) => line.startsWith("  ") || line === "flowchart TD")).toBe(true);
  });

  test("gives every path a fresh copy of the input, apart from the trigger node", async () => {
    const workflow = defineWorkflow({
      name: "mutates-input",
      run: async (ctx, input: { count: number }) => {
        input.count += 1;
        await ctx.waitForEvent("activated", { timeout: "1d" });
        await ctx.send("mail", message("ada@example.com", String(input.count), "Hi"));
      },
    });

    const graph = await inspectWorkflow(workflow, { input: { count: 0 } });
    const subjects = graph.nodes.flatMap((node) => (node.kind === "send" ? [node.email.subject] : []));

    expect(graph.paths).toHaveLength(2);
    expect(subjects).toEqual(["1", "1"]);
    expect(nodeById(graph, "$trigger")).toMatchObject({ kind: "trigger", input: { count: 0 } });
  });

  test("a step mock the workflow edits leaves the recorded result unchanged", async () => {
    const workflow = defineWorkflow({
      name: "edits-mock",
      run: async (ctx) => {
        const plan = await ctx.step<{ tier: string }>("load-plan", () => ({ tier: "free" }));

        plan.tier = "edited";
      },
    });

    const mock = { tier: "pro" };
    const graph = await inspectWorkflow(workflow, { input: null, steps: { "load-plan": mock } });

    expect(nodeById(graph, "load-plan")).toMatchObject({ result: { status: "mocked", value: { tier: "pro" } } });
    expect(mock).toEqual({ tier: "pro" });
  });

  test.each([
    [
      "as a Promise.all sibling of a step",
      async (ctx: WorkflowContext) => {
        await Promise.all([ctx.step("notify", () => 1), ctx.send("mail", message("ada@example.com", "Hi", "Hi"))]);
      },
    ],
    [
      "as a sibling the definition catches before going on",
      async (ctx: WorkflowContext) => {
        const results = await Promise.allSettled([ctx.step("notify", () => 1), ctx.sleep("pause", "1d")]);

        await ctx.send("mail", message("ada@example.com", String(results.length), "Hi"));
      },
    ],
  ])("a ctx call %s fails the path with the engine's error", async (_label, run) => {
    const workflow = defineWorkflow({ name: "overlap", run });

    const engine = createWorkflowEngine({
      store: createMemoryWorkflowStore(),
      email: { send: async () => ({ adapter: "test" }) },
      workflows: [workflow],
    });

    const failed = await engine.start(workflow, null);
    const graph = await inspectWorkflow(workflow, { input: null });

    expect(failed.status).toBe("failed");
    expect(graph.paths[0]?.outcome).toEqual({ status: "failed", error: failed.error?.message ?? "" });
    expect(graph.nodes.some((node) => node.kind === "send")).toBe(false);
  });

  test("validates input with the definition's schema", async () => {
    const workflow = defineWorkflow({
      name: "schema",
      input: {
        "~standard": {
          validate: (value) => (value === "ok" ? { value: "ok" } : { issues: [{ message: "expected ok" }] }),
        },
      },
      run: async () => undefined,
    });

    await expect(inspectWorkflow(workflow, { input: "nope" })).rejects.toThrow("expected ok");
    expect((await inspectWorkflow(workflow, { input: "ok" })).paths[0]?.outcome).toEqual({ status: "completed" });
  });
});

describe("describeRun", () => {
  test("turns a stored onboarding run into a timeline at each stage", async () => {
    const clock = createManualClock(Date.parse("2026-03-02T09:00:00Z"));
    const scheduler = createMemoryWorkflowScheduler(clock);
    let sent = 0;

    const engine = createWorkflowEngine({
      email: { send: async () => ({ adapter: "memory", id: `msg_${(sent += 1)}` }) },
      store: createMemoryWorkflowStore(),
      scheduler,
      clock,
      workflows: [onboarding],
    });

    const started = await engine.start(onboarding, ada, { id: "onboarding:u_1", subject: ada.email });
    const first = describeRun(started);

    expect(first).toMatchObject({
      runId: "onboarding:u_1",
      workflow: "onboarding",
      status: "waiting",
      subject: "ada@example.com",
      createdAt: "2026-03-02T09:00:00.000Z",
      wait: { kind: "sleep", step: "before-tip", until: "2026-03-04T09:00:00.000Z" },
    });

    expect(first.entries).toEqual([
      { status: "completed", step: "welcome", kind: "send", completedAt: "2026-03-02T09:00:00.000Z", summary: "Sent via memory (msg_1)" },
      { status: "waiting", step: "before-tip", kind: "sleep", until: "2026-03-04T09:00:00.000Z" },
    ]);

    await scheduler.advance("2d", engine);

    const waiting = describeRun((await engine.get("onboarding:u_1"))!);

    expect(waiting.wait).toEqual({ kind: "event", step: "activated", event: "activated", until: "2026-03-07T09:00:00.000Z" });
    expect(waiting.entries.at(-1)).toEqual({ status: "waiting", step: "activated", kind: "event", event: "activated", until: "2026-03-07T09:00:00.000Z" });

    await scheduler.advance("1d", engine);
    await engine.sendEvent({ name: "activated", subject: ada.email, payload: { plan: "pro" } });

    const done = describeRun((await engine.get("onboarding:u_1"))!);

    expect(done.status).toBe("completed");
    expect(done.wait).toBeUndefined();
    expect(done.output).toEqual({ outcome: "activated" });
    expect(done.entries.map((entry) => [entry.step, entry.status, entry.status === "completed" ? entry.summary : ""])).toEqual([
      ["welcome", "completed", "Sent via memory (msg_1)"],
      ["before-tip", "completed", "Waited"],
      ["tip", "completed", "Sent via memory (msg_2)"],
      ["activated", "completed", 'Received {"plan":"pro"}'],
      ["activated-mail", "completed", "Sent via memory (msg_3)"],
    ]);
  });

  test("lists steps in the order they ran, even when their names look like numbers", async () => {
    const clock = createManualClock(0);

    const numbers = defineWorkflow({
      name: "numbers",
      run: async (ctx) => {
        await ctx.step("10", () => 10);
        clock.advance("1s");
        await ctx.step("2", () => 2);
        await ctx.step("b", () => 3);
        await ctx.step("1", () => 1);
      },
    });

    const engine = createWorkflowEngine({
      clock,
      store: createMemoryWorkflowStore(),
      email: { send: async () => ({ adapter: "test" }) },
      workflows: [numbers],
    });

    const timeline = describeRun(await engine.start(numbers, null));

    expect(timeline.entries.map((entry) => entry.step)).toEqual(["10", "2", "b", "1"]);
  });

  test("numbers a legacy journal's retrying step before adding the next step, keeping run order", async () => {
    const clock = createManualClock(2_000);
    const store = createMemoryWorkflowStore();

    const numbers = defineWorkflow({
      name: "legacy-retry",
      run: async (ctx) => {
        await ctx.step("10", () => {
          clock.advance("1s");

          return 10;
        });
        await ctx.step("2", () => {
          clock.advance("1s");

          return 2;
        });
      },
    });

    // A run saved before journal entries carried a sequence, waiting to retry its first step.
    await store.create({
      id: "legacy",
      workflow: "legacy-retry",
      version: 1,
      status: "waiting",
      input: null,
      journal: { "10": { status: "retrying", kind: "step", attempts: 1, lastError: "503" } },
      wait: { kind: "retry", step: "10", until: 2_000 },
      inbox: [],
      revision: 1,
      createdAt: 0,
      updatedAt: 1_000,
      dueAt: 2_000,
    });

    const engine = createWorkflowEngine({ clock, store, email: { send: async () => ({ adapter: "test" }) }, workflows: [numbers] });

    await engine.resume("legacy");

    const run = await engine.get("legacy");

    expect(run?.status).toBe("completed");
    expect(run?.journal["10"]?.sequence).toBe(1);
    expect(run?.journal["2"]?.sequence).toBe(2);
    expect(run && describeRun(run).entries.map((entry) => entry.step)).toEqual(["10", "2"]);
  });

  test("numbers a legacy journal's completed steps in completion order before adding the next step", async () => {
    const clock = createManualClock(3_000);
    const store = createMemoryWorkflowStore();

    const numbers = defineWorkflow({
      name: "legacy-completed",
      run: async (ctx) => {
        await ctx.step("10", () => 10);
        await ctx.step("2", () => 2);
        await ctx.step("1", () => 1);
      },
    });

    await store.create({
      id: "legacy",
      workflow: "legacy-completed",
      version: 1,
      status: "running",
      input: null,
      journal: {
        "2": { status: "completed", kind: "step", result: 2, completedAt: 2_000 },
        "10": { status: "completed", kind: "step", result: 10, completedAt: 1_000 },
      },
      inbox: [],
      revision: 2,
      createdAt: 0,
      updatedAt: 2_000,
      dueAt: 3_000,
    });

    const engine = createWorkflowEngine({ clock, store, email: { send: async () => ({ adapter: "test" }) }, workflows: [numbers] });

    await engine.resume("legacy");

    const run = await engine.get("legacy");

    expect(run?.status).toBe("completed");
    expect([run?.journal["10"]?.sequence, run?.journal["2"]?.sequence, run?.journal["1"]?.sequence]).toEqual([1, 2, 3]);
  });

  test("orders a journal without sequence numbers by completion time, retrying steps last", () => {
    const timeline = describeRun({
      id: "r1",
      workflow: "w",
      version: 1,
      status: "waiting",
      input: null,
      journal: {
        "2": { status: "completed", kind: "step", result: 2, completedAt: 2_000 },
        "3": { status: "retrying", kind: "step", attempts: 1, lastError: "503" },
        "10": { status: "completed", kind: "step", result: 10, completedAt: 1_000 },
      },
      inbox: [],
      revision: 4,
      createdAt: 0,
      updatedAt: 3_000,
    });

    expect(timeline.entries.map((entry) => entry.step)).toEqual(["10", "2", "3"]);
  });

  test("reports cancellation and a retrying step", () => {
    const timeline = describeRun({
      id: "r1",
      workflow: "w",
      version: 2,
      status: "canceled",
      input: null,
      journal: {
        fetch: { status: "retrying", kind: "step", attempts: 2, lastError: "503" },
      },
      inbox: [],
      wait: { kind: "retry", step: "fetch", until: 60_000 },
      cancelReason: "unsubscribed",
      revision: 4,
      createdAt: 0,
      updatedAt: 1_000,
    });

    expect(timeline.cancelReason).toBe("unsubscribed");
    expect(timeline.entries).toEqual([
      { status: "retrying", step: "fetch", kind: "step", attempts: 2, lastError: "503", nextAttemptAt: "1970-01-01T00:01:00.000Z" },
    ]);
  });
});

describe("inspectWorkflow: definitions that catch ctx errors", () => {
  test("a loop that catches every ctx error is cut off at maxDepth instead of hanging", async () => {
    let calls = 0;

    const workflow = defineWorkflow({
      name: "spins",
      run: async (ctx) => {
        for (;;) {
          calls += 1;

          await ctx.send(`mail-${calls}`, message("ada@example.com", "Hi", "Hi")).catch(() => {});
        }
      },
    });

    const graph = await Promise.race([
      inspectWorkflow(workflow, { input: null, maxDepth: 3 }),
      new Promise<"hung">((resolve) => setTimeout(() => resolve("hung"), 1_000)),
    ]);

    expect(graph).not.toBe("hung");

    if (graph === "hung") return;

    expect(graph.truncated).toBe(true);
    expect(graph.paths[0]?.outcome).toEqual({ status: "truncated", reason: "More than 3 ctx calls in one path." });
    expect(graph.nodes.filter((node) => node.kind === "send")).toHaveLength(3);

    // The call past the cap never settles, so the loop parks instead of spinning on.
    const parked = calls;

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(calls).toBe(parked);
  });
});

describe("inspectWorkflow: never hangs", () => {
  // Each body makes one `ctx` call per iteration and catches whatever it rejects with. The loop is
  // bounded only so a regression fails the test instead of freezing the run: a body that gets this
  // far was never parked.
  const spinLimit = 10_000;

  type Spin = (ctx: WorkflowContext, index: number) => Promise<void>;

  const hi = message("ada@example.com", "Hi", "Hi");

  const spins = {
    "send, same name": async (ctx) => void (await ctx.send("same", hi)),
    "send, new names": async (ctx, index) => void (await ctx.send(`mail-${index}`, hi)),
    "send, reserved name": async (ctx) => void (await ctx.send("__proto__", hi)),
    "step, same name": async (ctx) => void (await ctx.step("same", () => 1)),
    "step, new names": async (ctx, index) => void (await ctx.step(`load-${index}`, () => 1)),
    "step, no attempts allowed": async (ctx, index) => void (await ctx.step(`load-${index}`, () => 1, { retry: { maxAttempts: 0 } })),
    "step, result that isn't JSON": async (ctx, index) => void (await ctx.step(`nan-${index}`, () => Number.NaN)),
    "step, overlapping call": async (ctx, index) => {
      void ctx.step(`slow-${index}`, () => 1);

      await ctx.sleep(`pause-${index}`, 0);
    },
    "sleep, same name": async (ctx) => await ctx.sleep("same", 0),
    "sleep, new names": async (ctx, index) => await ctx.sleep(`pause-${index}`, 0),
    "sleep, negative duration": async (ctx, index) => await ctx.sleep(`pause-${index}`, -1),
    "sleepUntil, same name": async (ctx) => await ctx.sleepUntil("same", 0),
    "sleepUntil, invalid date": async (ctx, index) => await ctx.sleepUntil(`until-${index}`, Number.NaN),
    "waitForEvent, same name": async (ctx) => void (await ctx.waitForEvent("same")),
    "waitForEvent, same name with a timeout": async (ctx) => void (await ctx.waitForEvent("same", { timeout: "1s" })),
    "waitForEvent, new names with a timeout": async (ctx, index) => void (await ctx.waitForEvent(`go-${index}`, { timeout: "1s" })),
    "waitForEvent, negative timeout": async (ctx, index) => void (await ctx.waitForEvent(`go-${index}`, { timeout: -1 })),
  } satisfies Record<string, Spin>;

  const steps = Object.fromEntries(Array.from({ length: 20 }, (_, index) => [`nan-${index}`, Number.NaN]));

  test.each(Object.entries(spins))("a loop that catches %s", async (_label, spin) => {
    const maxDepth = 3;
    const maxPaths = 4;
    let calls = 0;

    const workflow = defineWorkflow({
      name: "spins",
      run: async (ctx) => {
        for (let index = 0; index < spinLimit; index += 1) {
          calls += 1;

          await spin(ctx, index).catch(() => {});
        }
      },
    });

    const graph = await inspectWorkflow(workflow, { input: null, steps, maxDepth, maxPaths });

    // Each path makes at most `maxDepth` calls plus the one that is cut off or parks.
    expect(calls).toBeLessThanOrEqual(graph.paths.length * (maxDepth + 1));
    expect(graph.paths.length).toBeLessThanOrEqual(maxPaths);

    for (const path of graph.paths) expect(["failed", "truncated"]).toContain(path.outcome.status);

    const parked = calls;

    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(calls).toBe(parked);
  });
});
