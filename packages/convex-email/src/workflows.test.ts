import { describe, expect, test } from "bun:test";
import { createWorkflowEngine, defineWorkflow, workflowIdempotencyKey } from "@opencoredev/email-sdk/workflows";
import type { WorkflowRun } from "@opencoredev/email-sdk/workflows";
import { actionGeneric, componentsGeneric, defineSchema, makeFunctionReference } from "convex/server";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { z } from "zod";

import { ConvexEmail } from "./client/index.js";
import type { ConvexWorkflowEmailQueue } from "./client/workflows.js";
import {
  convexWorkflowEmail,
  convexWorkflowScheduler,
  convexWorkflowStore,
  parseWorkflowRun,
  toConvexSendArgs,
} from "./client/workflows.js";
import { api } from "./component/_generated/api.js";
import schema from "./component/schema.js";
import type { ConvexEmailSendArgs } from "./shared/types.js";
import { modules, registerConvexEmail } from "./testing.js";

function component() {
  const reference = componentsGeneric().convexEmail;

  if (!reference) throw new Error("The convexEmail component reference is missing.");

  return reference;
}

const email = new ConvexEmail(component(), { adapters: [{ kind: "memory" }], defaultAdapter: "memory" });

const onboarding = defineWorkflow({
  name: "onboarding",
  cancelOn: ["unsubscribed"],
  run: async (ctx, input: { email: string }) => {
    await ctx.send("welcome", { from: "hello@acme.test", to: input.email, subject: "Welcome", text: "Hi" });
    await ctx.sleep("wait-2d", "2d");

    const activated = await ctx.waitForEvent("activated", { timeout: "1d" });

    await ctx.send("follow-up", {
      from: "hello@acme.test",
      to: input.email,
      subject: activated.status === "received" ? "Thanks for activating" : "Need a hand?",
      text: "Hi again",
    });
  },
});

/** Waits on an event that never comes; only an unsubscribe ends it. Cheap to start in bulk. */
const parked = defineWorkflow({
  name: "parked",
  cancelOn: ["unsubscribed"],
  run: async (ctx) => {
    await ctx.waitForEvent("never");
  },
});

/** The app's clock. Tests move it instead of waiting, and the engine reads it through `clock`. */
const clock = { at: Date.parse("2026-01-01T00:00:00Z") };

const resumeRef = makeFunctionReference<"action", { runId: string }>("workflows:resume");

function engineFor(ctx: GenericActionCtx<GenericDataModel>) {
  return createWorkflowEngine({
    email: convexWorkflowEmail(email, ctx),
    store: convexWorkflowStore(component(), ctx),
    scheduler: convexWorkflowScheduler(ctx, resumeRef),
    clock: { now: () => clock.at },
    workflows: [onboarding, parked],
  });
}

const vRunView = v.object({ status: v.string(), revision: v.number() });

function view(run: WorkflowRun | undefined) {
  return { status: run?.status ?? "missing", revision: run?.revision ?? -1 };
}

const appWorkflows = {
  start: actionGeneric({
    args: { runId: v.string(), email: v.string() },
    returns: vRunView,
    handler: async (ctx, args) =>
      view(await engineFor(ctx).start(onboarding, { email: args.email }, { id: args.runId, subject: args.email })),
  }),
  resume: actionGeneric({
    args: { runId: v.string() },
    returns: vRunView,
    handler: async (ctx, args) => view(await engineFor(ctx).resume(args.runId)),
  }),
  startParked: actionGeneric({
    args: { count: v.number(), subject: v.string() },
    returns: v.null(),
    handler: async (ctx, args) => {
      const engine = engineFor(ctx);

      for (let index = 0; index < args.count; index += 1) {
        await engine.start(parked, null, { id: `parked-${index}`, subject: args.subject });
      }

      return null;
    },
  }),
  resumeDue: actionGeneric({
    args: { limit: v.number() },
    returns: v.number(),
    handler: async (ctx, args) => await engineFor(ctx).resumeDue(args.limit),
  }),
  sendEvent: actionGeneric({
    args: { name: v.string(), subject: v.string() },
    returns: v.array(v.string()),
    handler: async (ctx, args) => await engineFor(ctx).sendEvent({ name: args.name, subject: args.subject }),
  }),
  emailStatus: actionGeneric({
    args: { emailId: v.string() },
    returns: v.union(v.object({ subject: v.string(), status: v.string(), idempotencyKey: v.optional(v.string()) }), v.null()),
    handler: async (ctx, args) => {
      const record = await ctx.runQuery(component().lib.status, args);

      return record
        ? { subject: record.message.subject, status: record.status, idempotencyKey: record.idempotencyKey }
        : null;
    },
  }),
  get: actionGeneric({
    args: { runId: v.string() },
    returns: v.union(v.string(), v.null()),
    handler: async (ctx, args) => {
      const run = await engineFor(ctx).get(args.runId);

      return run ? JSON.stringify(run) : null;
    },
  }),
};

const app = {
  start: makeFunctionReference<"action", { runId: string; email: string }, { status: string; revision: number }>(
    "workflows:start",
  ),
  resume: makeFunctionReference<"action", { runId: string }, { status: string; revision: number }>("workflows:resume"),
  sendEvent: makeFunctionReference<"action", { name: string; subject: string }, string[]>("workflows:sendEvent"),
  resumeDue: makeFunctionReference<"action", { limit: number }, number>("workflows:resumeDue"),
  startParked: makeFunctionReference<"action", { count: number; subject: string }, null>("workflows:startParked"),
  get: makeFunctionReference<"action", { runId: string }, string | null>("workflows:get"),
  emailStatus: makeFunctionReference<
    "action",
    { emailId: string },
    { subject: string; status: string; idempotencyKey?: string } | null
  >("workflows:emailStatus"),
};

const appModules = {
  "./app/_generated/api.ts": async () => ({}),
  "./app/workflows.ts": async () => appWorkflows,
};

function createApp() {
  const t = convexTest(defineSchema({}), appModules);

  registerConvexEmail(t);

  return t;
}

async function readRun(t: ReturnType<typeof createApp>, runId: string): Promise<WorkflowRun> {
  const state = await t.action(app.get, { runId });

  if (!state) throw new Error(`Run ${runId} is missing.`);

  // SAFETY: the `get` action serializes the WorkflowRun the engine returned, unchanged.
  return JSON.parse(state) as WorkflowRun;
}

async function scheduledResumes(t: ReturnType<typeof createApp>) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();

    return jobs.map((job) => ({ name: job.name, at: job.scheduledTime, args: job.args }));
  });
}

/** Looks up the component email each send step queued, through the component's status query. */
async function queuedEmails(t: ReturnType<typeof createApp>, run: WorkflowRun) {
  const emails = [];

  for (const record of Object.values(run.journal)) {
    if (record.status !== "completed" || record.kind !== "send") continue;

    const sent = z.object({ id: z.string() }).parse(record.result);

    emails.push(await t.action(app.emailStatus, { emailId: sent.id }));
  }

  return emails;
}

describe("convex workflow store functions", () => {
  const record = {
    runId: "run-1",
    workflow: "onboarding",
    status: "running",
    subject: "ada@example.test",
    active: true,
    dueAt: 100,
    revision: 0,
    state: "{}",
  };

  test("createRun refuses a duplicate id and saveRun checks the revision", async () => {
    const t = convexTest(schema, modules);

    expect(await t.mutation(api.workflows.createRun, { run: record })).toBe(true);
    expect(await t.mutation(api.workflows.createRun, { run: record })).toBe(false);

    const next = { ...record, revision: 1, state: '{"v":1}' };

    expect(await t.mutation(api.workflows.saveRun, { run: next, expectedRevision: 0 })).toBe(true);
    expect(await t.mutation(api.workflows.saveRun, { run: { ...next, revision: 2 }, expectedRevision: 0 })).toBe(false);
    expect(await t.query(api.workflows.getRun, { runId: "run-1" })).toMatchObject({ revision: 1, state: '{"v":1}' });
    expect(await t.query(api.workflows.getRun, { runId: "missing" })).toBeNull();
  });

  test("listDueRuns and listActiveRunsBySubject only return active runs", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.workflows.createRun, { run: record });
    await t.mutation(api.workflows.createRun, { run: { ...record, runId: "later", dueAt: 500 } });
    await t.mutation(api.workflows.createRun, { run: { ...record, runId: "event-wait", dueAt: undefined } });
    await t.mutation(api.workflows.createRun, {
      run: { ...record, runId: "done", status: "completed", active: false, dueAt: undefined },
    });

    const firstPage = { numItems: 10, cursor: null };

    expect((await t.query(api.workflows.listDueRuns, { now: 100, paginationOpts: firstPage })).page).toEqual(["run-1"]);
    expect((await t.query(api.workflows.listDueRuns, { now: 1_000, paginationOpts: firstPage })).page).toEqual([
      "run-1",
      "later",
    ]);
    expect(await t.query(api.workflows.listDueRuns, { now: 1_000, paginationOpts: { numItems: 0, cursor: null } })).toMatchObject({
      page: [],
      isDone: true,
    });

    const active = await t.query(api.workflows.listActiveRunsBySubject, {
      subject: "ada@example.test",
      paginationOpts: { numItems: 10, cursor: null },
    });

    expect(active.isDone).toBe(true);
    expect(active.page.map((run) => run.runId).sort()).toEqual(["event-wait", "later", "run-1"]);
  });

  test("listDueRuns pages through every due run, oldest first", async () => {
    const t = convexTest(schema, modules);

    for (let index = 0; index < 5; index += 1) {
      await t.mutation(api.workflows.createRun, { run: { ...record, runId: `run-${index}`, dueAt: 100 - index } });
    }

    const seen: string[] = [];
    let cursor: string | null = null;

    for (let pages = 1; pages <= 5; pages += 1) {
      const result: { page: string[]; isDone: boolean; continueCursor: string } = await t.query(
        api.workflows.listDueRuns,
        { now: 1_000, paginationOpts: { numItems: 2, cursor } },
      );

      seen.push(...result.page);

      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    expect(seen).toEqual(["run-4", "run-3", "run-2", "run-1", "run-0"]);
  });

  test("listActiveRunsBySubject pages through every active run", async () => {
    const t = convexTest(schema, modules);

    for (let index = 0; index < 5; index += 1) {
      await t.mutation(api.workflows.createRun, { run: { ...record, runId: `run-${index}` } });
    }

    const seen: string[] = [];
    let cursor: string | null = null;

    for (let pages = 1; pages <= 5; pages += 1) {
      const result: { page: { runId: string }[]; isDone: boolean; continueCursor: string } = await t.query(
        api.workflows.listActiveRunsBySubject,
        { subject: "ada@example.test", paginationOpts: { numItems: 2, cursor } },
      );

      seen.push(...result.page.map((run) => run.runId));

      if (result.isDone) break;
      cursor = result.continueCursor;
    }

    expect(seen.sort()).toEqual(["run-0", "run-1", "run-2", "run-3", "run-4"]);
  });
});

describe("convex workflow engine end to end", () => {
  test("runs a drip through the component queue, scheduler, and store", async () => {
    clock.at = Date.parse("2026-01-01T00:00:00Z");

    const t = createApp();

    expect(await t.action(app.start, { runId: "run-1", email: "ada@example.test" })).toMatchObject({ status: "waiting" });
    expect(await t.action(app.start, { runId: "run-1", email: "ada@example.test" })).toMatchObject({ status: "waiting" });

    let run = await readRun(t, "run-1");

    expect(run.wait).toEqual({ kind: "sleep", step: "wait-2d", until: clock.at + 2 * 86_400_000 });
    expect(run.journal.welcome).toMatchObject({ status: "completed", result: { adapter: "convex-email" } });
    expect(await scheduledResumes(t)).toContainEqual({
      name: "workflows:resume",
      at: clock.at + 2 * 86_400_000,
      args: [{ runId: "run-1" }],
    });

    // A timer that fires early changes nothing.
    await t.action(app.resume, { runId: "run-1" });
    expect((await readRun(t, "run-1")).revision).toBe(run.revision);

    clock.at += 2 * 86_400_000;
    await t.action(app.resume, { runId: "run-1" });
    run = await readRun(t, "run-1");
    expect(run.wait).toMatchObject({ kind: "event", step: "activated" });

    expect(await t.action(app.sendEvent, { name: "activated", subject: "ada@example.test" })).toEqual(["run-1"]);
    run = await readRun(t, "run-1");
    expect(run.status).toBe("completed");

    expect((await queuedEmails(t, run)).map((queued) => [queued?.subject, queued?.idempotencyKey])).toEqual([
      ["Welcome", await workflowIdempotencyKey("run-1", "welcome")],
      ["Thanks for activating", await workflowIdempotencyKey("run-1", "follow-up")],
    ]);
  });

  test("resumeDue(0) executes no due run; a positive limit does", async () => {
    clock.at = Date.parse("2026-01-01T00:00:00Z");

    const t = createApp();

    await t.action(app.start, { runId: "run-4", email: "ada@example.test" });
    clock.at += 2 * 86_400_000;

    expect(await t.action(app.resumeDue, { limit: 0 })).toBe(0);
    expect((await readRun(t, "run-4")).wait).toMatchObject({ kind: "sleep" });
    expect(await t.action(app.resumeDue, { limit: 1 })).toBe(1);
    expect((await readRun(t, "run-4")).wait).toMatchObject({ kind: "event" });
  });

  test("an early wake schedules a new resume for the run's persisted due time", async () => {
    clock.at = Date.parse("2026-01-01T00:00:00Z");

    const t = createApp();

    await t.action(app.start, { runId: "run-3", email: "ada@example.test" });

    const run = await readRun(t, "run-3");

    // Lose the real timer, as if only a stale early job had been left for this run.
    await t.run(async (ctx) => {
      for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
        if (job.name === "workflows:resume") await ctx.scheduler.cancel(job._id);
      }
    });

    expect(await pendingResumes(t)).toEqual([]);
    expect(await t.action(app.resume, { runId: "run-3" })).toMatchObject({ status: "waiting", revision: run.revision });
    expect(await pendingResumes(t)).toEqual([{ at: run.dueAt, runId: "run-3" }]);
  });
});

async function pendingResumes(t: ReturnType<typeof createApp>) {
  return await t.run(async (ctx) => {
    const jobs = await ctx.db.system.query("_scheduled_functions").collect();

    return jobs.flatMap((job) =>
      job.name === "workflows:resume" && job.state.kind === "pending"
        ? [{ at: job.scheduledTime, runId: z.object({ runId: z.string() }).parse(job.args[0]).runId }]
        : [],
    );
  });
}

describe("convex workflow cancellation", () => {
  test("an unsubscribe event cancels the run and takes it off the due index", async () => {
    clock.at = Date.parse("2026-01-01T00:00:00Z");

    const t = createApp();

    await t.action(app.start, { runId: "run-2", email: "grace@example.test" });
    expect(await t.action(app.sendEvent, { name: "unsubscribed", subject: "grace@example.test" })).toEqual(["run-2"]);

    const run = await readRun(t, "run-2");

    expect(run.status).toBe("canceled");
    expect(run.cancelReason).toBe("event:unsubscribed");

    clock.at += 3 * 86_400_000;
    expect(await t.action(app.resume, { runId: "run-2" })).toMatchObject({ status: "canceled", revision: run.revision });
    expect((await queuedEmails(t, run)).map((queued) => queued?.subject)).toEqual(["Welcome"]);
    expect(await t.action(app.sendEvent, { name: "activated", subject: "grace@example.test" })).toEqual([]);
  });
});

describe("convex workflow subject events", () => {
  test("an unsubscribe reaches every active run for the subject, past one page", async () => {
    const t = createApp();

    await t.action(app.startParked, { count: 101, subject: "bulk@example.test" });
    expect(await t.action(app.sendEvent, { name: "unsubscribed", subject: "bulk@example.test" })).toHaveLength(101);

    const statuses = new Set<string>();

    for (let index = 0; index < 101; index += 1) statuses.add((await readRun(t, `parked-${index}`)).status);

    expect([...statuses]).toEqual(["canceled"]);
  }, 60_000);
});

describe("parseWorkflowRun", () => {
  test("keeps the execution lease, which guards runs against concurrent workers", () => {
    const run: WorkflowRun = {
      id: "run-1",
      workflow: "onboarding",
      version: 1,
      status: "running",
      input: null,
      journal: { lookup: { status: "completed", kind: "step", result: null, completedAt: 1 } },
      inbox: [],
      lease: { owner: "worker-a", until: 500 },
      revision: 3,
      dueAt: 500,
      createdAt: 1,
      updatedAt: 2,
    };

    expect(parseWorkflowRun(JSON.stringify(run))).toEqual(run);
  });
});

describe("toConvexSendArgs", () => {
  test("maps a message and rejects what the queue cannot store", () => {
    expect(
      toConvexSendArgs(
        {
          from: "a@acme.test",
          to: ["b@acme.test", { email: "c@acme.test", name: "C" }],
          subject: "Hi",
          text: "Hi",
          headers: [{ name: "X-Test", value: "1" }],
          attachments: [{ filename: "a.txt", content: "aGk=", contentEncoding: "base64" }],
        },
        { idempotencyKey: "wf:run-1:welcome" },
      ),
    ).toEqual({
      from: "a@acme.test",
      to: ["b@acme.test", { email: "c@acme.test", name: "C" }],
      subject: "Hi",
      text: "Hi",
      headers: [{ name: "X-Test", value: "1" }],
      attachments: [{ filename: "a.txt", content: "aGk=", contentEncoding: "base64" }],
      idempotencyKey: "wf:run-1:welcome",
    });

    expect(() =>
      toConvexSendArgs({ from: "a@acme.test", to: "b@acme.test", subject: "Hi", text: "Hi", sendAt: new Date() }),
    ).toThrow("sendAt");
    expect(() =>
      toConvexSendArgs(
        { from: "a@acme.test", to: "b@acme.test", subject: "Hi", text: "Hi", attachments: [{ filename: "a.bin", content: new Uint8Array([1]) }] },
      ),
    ).toThrow("string content");
  });
});

describe("convexWorkflowEmail send options", () => {
  const message = { from: "a@acme.test", to: "b@acme.test", subject: "Hi", text: "Hi" };

  test("forwards routing, attempts, and metadata to the queue", async () => {
    const queued: ConvexEmailSendArgs[] = [];

    const queue: ConvexWorkflowEmailQueue = {
      async send(_ctx, args) {
        queued.push(args);

        return "email-1";
      },
    };

    const sender = convexWorkflowEmail(queue, { runMutation: async () => null });

    await sender.send(message, {
      adapter: "backup",
      fallback: { adapters: ["third"] },
      retry: { maxAttempts: 2 },
      metadata: { userId: "u1", attempt: 1, skipped: undefined },
      idempotencyKey: "wf_1",
    });

    expect(queued).toEqual([
      {
        ...message,
        adapter: "backup",
        fallbackAdapters: ["third"],
        maxAttempts: 2,
        sendMetadata: { userId: "u1", attempt: 1 },
        idempotencyKey: "wf_1",
      },
    ]);
  });

  test("rejects options the queue cannot honor instead of dropping them", () => {
    expect(() => toConvexSendArgs(message, { signal: new AbortController().signal })).toThrow("signal");
    expect(() => toConvexSendArgs(message, { retry: { delay: () => 1 } })).toThrow("retry.maxAttempts");
    expect(() => toConvexSendArgs(message, { fallback: { adapters: ["b"], onUnknownDelivery: "continue" } })).toThrow(
      "onUnknownDelivery",
    );
    expect(() => toConvexSendArgs(message, { metadata: { nested: { a: 1 } } })).toThrow("flat metadata");
  });
});
