import { describe, expect, test } from "bun:test";

import { isObjectLike } from "./internal/decode.js";
import type { EmailMessage } from "./types.js";
import {
  createManualClock,
  createMemoryWorkflowScheduler,
  createMemoryWorkflowStore,
  createWorkflowEngine,
  defineWorkflow,
  inspectWorkflow,
} from "./workflows.js";
import type { AnyWorkflowDefinition, WorkflowContext, WorkflowJsonValue, WorkflowRunStatus } from "./workflows.js";

const start = Date.parse("2026-01-01T00:00:00.000Z");

function mail(subject: string): EmailMessage {
  return { from: "Acme <hello@acme.test>", to: "ada@example.test", subject, text: subject };
}

type Run = (ctx: WorkflowContext, input: WorkflowJsonValue) => Promise<WorkflowJsonValue | void> | WorkflowJsonValue | void;

type ParityCase = {
  run: Run;
  input?: WorkflowJsonValue;
  /** The engine runs each step callback; the inspector returns this mock for the step instead. */
  steps?: Record<string, WorkflowJsonValue>;
  schema?: AnyWorkflowDefinition["input"];
  /** What both must report, checked on top of agreeing with each other. */
  expected: { status: WorkflowRunStatus; error?: string; sends: string[] };
};

type Observed = { status: WorkflowRunStatus | "truncated" | "rejected"; error?: string; sends: string[] };

type Cyclic = { self?: WorkflowJsonValue };

const cyclic = (): WorkflowJsonValue => {
  const value: Cyclic = {};

  value.self = value;

  return value;
};

const never = new Promise<never>(() => {});

const outputError = "The workflow output must be JSON.";

const cases = {
  "a caught invalid sleep duration": {
    run: async (ctx) => {
      await ctx.sleep("pause", -1).catch(() => {});
      await ctx.send("after", mail("After"));
    },
    expected: { status: "failed", error: "Duration -1 must not be negative.", sends: [] },
  },
  "a caught malformed sleep duration": {
    run: async (ctx) => {
      // SAFETY: untyped callers can pass any string; this checks the runtime rejection.
      await ctx.sleep("pause", "soon" as "1d").catch(() => {});
      await ctx.send("after", mail("After"));
    },
    expected: { status: "failed", error: 'Invalid duration "soon"', sends: [] },
  },
  "a caught invalid sleepUntil date": {
    run: async (ctx) => {
      await ctx.sleepUntil("pause", new Date(Number.NaN)).catch(() => {});
      await ctx.send("after", mail("After"));
    },
    expected: { status: "failed", error: 'sleepUntil "pause" needs a valid Date or epoch milliseconds.', sends: [] },
  },
  "a caught invalid event timeout": {
    run: async (ctx) => {
      await ctx.waitForEvent("go", { timeout: -5 }).catch(() => {});
      await ctx.send("after", mail("After"));
    },
    expected: { status: "failed", error: "Duration -5 must not be negative.", sends: [] },
  },
  "a NaN output": {
    run: async (ctx) => {
      await ctx.send("hello", mail("Hello"));

      return Number.NaN;
    },
    expected: { status: "failed", error: outputError, sends: ["hello"] },
  },
  "an Infinity output": {
    run: async () => Number.POSITIVE_INFINITY,
    expected: { status: "failed", error: outputError, sends: [] },
  },
  "a cyclic output": {
    run: async () => cyclic(),
    expected: { status: "failed", error: outputError, sends: [] },
  },
  "a JSON output": {
    run: async (ctx) => {
      await ctx.send("hello", mail("Hello"));

      return { ok: true };
    },
    expected: { status: "completed", sends: ["hello"] },
  },
  "input with an undefined field the schema checks for": {
    input: { provided: undefined },
    schema: {
      "~standard": {
        validate: (value) =>
          isObjectLike(value) && Object.hasOwn(value, "provided")
            ? { value: { provided: true } }
            : { issues: [{ message: "provided is missing" }] },
      },
    },
    run: async (ctx, input) => {
      await ctx.send("hello", mail(JSON.stringify(input)));
    },
    expected: { status: "completed", sends: ["hello"] },
  },
  "an overlap inside Promise.all": {
    run: async (ctx) => {
      await Promise.all([ctx.step("notify", () => 1), ctx.send("mail", mail("Hi"))]);
    },
    steps: { notify: 1 },
    expected: { status: "failed", error: '"mail" was called while step "notify" was still running.', sends: [] },
  },
  "an overlap the definition catches": {
    run: async (ctx) => {
      await Promise.allSettled([ctx.step("notify", () => 1), ctx.sleep("pause", "1d")]);
      await ctx.send("after", mail("After"));
    },
    steps: { notify: 1 },
    expected: { status: "failed", error: '"pause" was called while step "notify" was still running.', sends: [] },
  },
  "a reserved step name": {
    run: async (ctx) => {
      await ctx.send("__proto__", mail("Hi"));
    },
    expected: { status: "failed", error: "\"__proto__\" can't name a step", sends: [] },
  },
  "a reserved step name the definition catches": {
    run: async (ctx) => {
      await ctx.step("__proto__", () => 1).catch(() => {});
      await ctx.send("after", mail("After"));
    },
    expected: { status: "failed", error: "\"__proto__\" can't name a step", sends: [] },
  },
  "a duplicate step name": {
    run: async (ctx) => {
      await ctx.send("hello", mail("One"));
      await ctx.send("hello", mail("Two"));
    },
    expected: { status: "failed", error: 'Step "hello" ran twice in workflow parity@1.', sends: ["hello"] },
  },
  "a step result that isn't JSON": {
    run: async (ctx) => {
      await ctx.step("load", () => Number.NaN).catch(() => {});
      await ctx.send("after", mail("After"));
    },
    steps: { load: Number.NaN },
    expected: { status: "failed", error: 'The result of step "load" must be JSON', sends: [] },
  },
  "a synchronous throw": {
    run: () => {
      throw new Error("sync boom");
    },
    expected: { status: "failed", error: "sync boom", sends: [] },
  },
  "a rejection beside a pending step": {
    run: async (ctx) => {
      await Promise.all([ctx.step("hang", async () => await never), Promise.reject(new Error("sibling broke"))]);
    },
    steps: { hang: null },
    expected: { status: "failed", error: "sibling broke", sends: [] },
  },
  "a sleep, then sends": {
    run: async (ctx) => {
      await ctx.send("first", mail("First"));
      await ctx.sleep("pause", "1d");
      await ctx.send("second", mail("Second"));
    },
    expected: { status: "completed", sends: ["first", "second"] },
  },
} satisfies Record<string, ParityCase>;

function definitionFor(entry: ParityCase): AnyWorkflowDefinition {
  // SAFETY: the table's `run` functions take any JSON input, which is what an untyped definition gets.
  return defineWorkflow({ name: "parity", input: entry.schema, run: entry.run as (ctx: WorkflowContext, input: WorkflowJsonValue) => Promise<WorkflowJsonValue | void> });
}

/** Settles with "hung" when `promise` hasn't settled within `ms`. */
async function within<T>(promise: Promise<T>, ms: number): Promise<T | "hung"> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const hung = new Promise<"hung">((resolve) => {
    timer = setTimeout(() => resolve("hung"), ms);
  });

  try {
    return await Promise.race([promise, hung]);
  } finally {
    clearTimeout(timer);
  }
}

async function throughEngine(definition: AnyWorkflowDefinition, input: WorkflowJsonValue): Promise<Observed> {
  const clock = createManualClock(start);
  const scheduler = createMemoryWorkflowScheduler(clock);
  const sends: string[] = [];

  const engine = createWorkflowEngine({
    store: createMemoryWorkflowStore(),
    scheduler,
    clock,
    leaseDuration: "30ms",
    workflows: [definition],
    email: {
      async send(_message, _options, context) {
        if (context) sends.push(context.step);

        return { adapter: "parity" };
      },
    },
  });

  const started = await within(engine.start(definition, input, { id: "run-1" }).then(
    (run) => run,
    (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
  ), 1_000);

  if (started === "hung") return { status: "truncated", error: "engine.start hung", sends };

  if (started instanceof Error) return { status: "rejected", error: started.message, sends };

  for (let wake = 0; wake < 10; wake += 1) {
    const run = await engine.get("run-1");

    if (run?.status !== "waiting" || run.wait?.until === undefined) break;

    await scheduler.advance(run.wait.until - clock.now(), engine);
  }

  const run = await engine.get("run-1");

  return run?.error ? { status: run.status, error: run.error.message, sends } : { status: run?.status ?? "rejected", sends };
}

async function throughInspector(definition: AnyWorkflowDefinition, entry: ParityCase): Promise<Observed> {
  const graph = await within(
    inspectWorkflow(definition, { input: entry.input ?? null, steps: entry.steps }).then(
      (value) => value,
      (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
    ),
    1_000,
  );

  if (graph === "hung") return { status: "truncated", error: "inspectWorkflow hung", sends: [] };

  if (graph instanceof Error) return { status: "rejected", error: graph.message, sends: [] };

  const [path, ...others] = graph.paths;

  expect(others).toEqual([]);

  const sends = (path?.nodes ?? []).flatMap((id) => {
    const node = graph.nodes.find((item) => item.id === id);

    return node?.kind === "send" ? [node.step] : [];
  });

  const outcome = path?.outcome;

  if (outcome?.status === "failed") return { status: "failed", error: outcome.error, sends };

  return { status: outcome?.status ?? "rejected", sends };
}

describe("workflows: engine and inspector agree", () => {
  test.each(Object.entries(cases))("%s", async (_label, entry: ParityCase) => {
    const definition = definitionFor(entry);
    const engine = await throughEngine(definition, entry.input ?? null);
    const inspected = await throughInspector(definition, entry);

    expect(inspected).toEqual(engine);
    expect(engine.status).toBe(entry.expected.status);
    expect(engine.sends).toEqual(entry.expected.sends);

    if (entry.expected.error === undefined) expect(engine.error).toBeUndefined();
    else expect(engine.error).toContain(entry.expected.error);
  });
});
