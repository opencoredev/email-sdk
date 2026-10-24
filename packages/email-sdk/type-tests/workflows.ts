import { z } from "zod";

import { createEmailClient } from "../src/index.js";
import { memoryAdapter } from "../src/testing.js";
import {
  createManualClock,
  createMemoryWorkflowScheduler,
  createMemoryWorkflowStore,
  createWorkflowEngine,
  defineWorkflow,
} from "../src/workflows.js";
import type { WorkflowEventResult, WorkflowRun, WorkflowSendRecord } from "../src/workflows.js";

type Signup = { email: string; plan: "free" | "pro"; referrer?: string };

const fromAnnotation = defineWorkflow({
  name: "annotated",
  cancelOn: ["unsubscribed"],
  run: async (ctx, input: Signup) => {
    const sent: WorkflowSendRecord = await ctx.send("welcome", {
      from: "a@example.test",
      to: input.email,
      subject: "Hi",
      text: "Hi",
    });

    const count: number = await ctx.step("count", () => 1);
    const nothing: void = await ctx.step("side-effect", () => {});

    const event: WorkflowEventResult<{ seats: number }> = await ctx.waitForEvent<{ seats: number }>("upgraded", {
      timeout: "7d",
    });

    if (event.status === "received") {
      const seats: number = event.payload.seats;
      void seats;
    }

    // @ts-expect-error Date is not JSON, so it cannot be journaled and replayed faithfully
    await ctx.step("when", () => new Date());

    // @ts-expect-error durations need a unit suffix
    await ctx.sleep("bad", "2 days");

    void sent;
    void count;
    void nothing;

    return { plan: input.plan };
  },
});

const fromSchema = defineWorkflow({
  name: "schema",
  input: z.object({ userId: z.string(), email: z.email() }),
  run: async (ctx, input) => {
    const userId: string = input.userId;

    await ctx.sleep("wait", "1d");
    void userId;
  },
});

// The schema accepts a string and fills a default; `run` sees the parsed output.
const transformed = defineWorkflow({
  name: "transformed",
  input: z.object({ count: z.string().transform(Number), plan: z.enum(["free", "pro"]).default("free") }),
  run: async (_ctx, input) => {
    const count: number = input.count;
    const plan: "free" | "pro" = input.plan;

    void count;
    void plan;
  },
});

const clock = createManualClock(0);

const engine = createWorkflowEngine({
  email: createEmailClient({ adapters: [memoryAdapter()] }),
  store: createMemoryWorkflowStore(),
  scheduler: createMemoryWorkflowScheduler(clock),
  clock,
  workflows: [fromAnnotation, fromSchema, transformed],
});

const started: Promise<WorkflowRun> = engine.start(fromAnnotation, { email: "a@example.test", plan: "pro" });

// @ts-expect-error input must match the definition's input type
void engine.start(fromAnnotation, { email: "a@example.test", plan: "enterprise" });

// @ts-expect-error events target a run id or a subject, not both
void engine.sendEvent({ name: "activated", runId: "r", subject: "s" });

void engine.start(fromSchema, { userId: "u_1", email: "a@example.test" });

// start takes what the schema accepts: a string count, and the defaulted plan may be left out.
void engine.start(transformed, { count: "42" });

// @ts-expect-error start takes the schema's input, not its parsed output
void engine.start(transformed, { count: 42 });

void started;

// @ts-expect-error workflows are not exported from the package root
import { defineWorkflow as rootDefineWorkflow } from "../src/index.js";

void rootDefineWorkflow;
