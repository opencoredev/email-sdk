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
import type { WorkflowInspectGraph, WorkflowInspectNode } from "./workflows.js";

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
      ["trigger", "trigger", 0],
      ["welcome", "send", 0],
      ["before-tip", "sleep", 0],
      ["tip", "send", 172_800_000],
      ["activated", "waitForEvent", 172_800_000],
      ["activated:received/activated-mail", "send", 172_800_000],
      ["activated:received/end", "end", 172_800_000],
      ["activated:timeout/nudge", "send", 432_000_000],
      ["activated:timeout/end", "end", 432_000_000],
    ]);

    expect(graph.edges).toEqual([
      { from: "trigger", to: "welcome" },
      { from: "welcome", to: "before-tip" },
      { from: "before-tip", to: "tip" },
      { from: "tip", to: "activated" },
      { from: "activated", to: "activated:received/activated-mail", branch: "received" },
      { from: "activated:received/activated-mail", to: "activated:received/end" },
      { from: "activated", to: "activated:timeout/nudge", branch: "timeout" },
      { from: "activated:timeout/nudge", to: "activated:timeout/end" },
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
