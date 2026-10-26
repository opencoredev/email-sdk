import { describe, expect, test } from "bun:test";
import {
  createMemoryWorkflowStore,
  createWorkflowEngine,
  defineWorkflow,
  workflowIdempotencyKey,
} from "@opencoredev/email-sdk/workflows";
import type { WorkflowEmailSender, WorkflowRun } from "@opencoredev/email-sdk/workflows";
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
import { api, internal } from "./component/_generated/api.js";
import schema from "./component/schema.js";
import type { ConvexWorkflowSendArgs } from "./shared/types.js";
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

/** Counts runs of its `__proto__` step, which the Convex journal schema can't keep. */
const protoCalls = { count: 0 };

const protoStep = defineWorkflow({
  name: "proto-step",
  run: async (ctx) => {
    await ctx.step("__proto__", () => {
      protoCalls.count += 1;
    });
    await ctx.sleep("nap", "1h");
  },
});

/** Hangs the first call of its step until `stalled.release()`, standing in for an action that died. */
const stalled = { calls: 0, release: () => {} };

const stalledStep = defineWorkflow({
  name: "stalled-step",
  run: async (ctx) => {
    await ctx.step("charge", async () => {
      stalled.calls += 1;

      if (stalled.calls === 1) {
        await new Promise<void>((resolve) => {
          stalled.release = resolve;
        });
      }

      return stalled.calls;
    });
  },
});

/** Sends one email. The first execution's action "dies" right after the component queued it. */
const crashEmailIds: string[] = [];

const crash = { sends: 0, emailIds: crashEmailIds, release: () => {} };

const sendOnce = defineWorkflow({
  name: "send-once",
  run: async (ctx) => {
    await ctx.send("welcome", { from: "hello@acme.test", to: "ada@example.test", subject: "Welcome", text: "Hi" });
  },
});

function crashingSender(ctx: GenericActionCtx<GenericDataModel>): WorkflowEmailSender {
  const sender = convexWorkflowEmail(email, ctx);

  return {
    async send(message, options, context) {
      const result = await sender.send(message, options, context);

      crash.sends += 1;

      if (result.id !== undefined) crash.emailIds.push(result.id);

      if (crash.sends === 1) {
        await new Promise<void>((resolve) => {
          crash.release = resolve;
        });
      }

      return result;
    },
  };
}

/** The app's clock. Tests move it instead of waiting, and the engine reads it through `clock`. */
const clock = { at: Date.parse("2026-01-01T00:00:00Z") };

const resumeRef = makeFunctionReference<"action", { runId: string }>("workflows:resume");

function engineFor(ctx: GenericActionCtx<GenericDataModel>) {
  return createWorkflowEngine({
    email: convexWorkflowEmail(email, ctx),
    store: convexWorkflowStore(component(), ctx),
    scheduler: convexWorkflowScheduler(ctx, resumeRef),
    clock: { now: () => clock.at },
    workflows: [onboarding, parked, protoStep, stalledStep],
  });
}

function crashingEngineFor(ctx: GenericActionCtx<GenericDataModel>) {
  return createWorkflowEngine({
    email: crashingSender(ctx),
    store: convexWorkflowStore(component(), ctx),
    scheduler: convexWorkflowScheduler(ctx, resumeRef),
    clock: { now: () => clock.at },
    workflows: [sendOnce],
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
  startProto: actionGeneric({
    args: { runId: v.string() },
    returns: vRunView,
    handler: async (ctx, args) => view(await engineFor(ctx).start(protoStep, null, { id: args.runId })),
  }),
  startStalled: actionGeneric({
    args: { runId: v.string() },
    returns: vRunView,
    handler: async (ctx, args) => view(await engineFor(ctx).start(stalledStep, null, { id: args.runId })),
  }),
  startSendOnce: actionGeneric({
    args: { runId: v.string() },
    returns: vRunView,
    handler: async (ctx, args) => view(await crashingEngineFor(ctx).start(sendOnce, null, { id: args.runId })),
  }),
  resumeSendOnce: actionGeneric({
    args: { runId: v.string() },
    returns: vRunView,
    handler: async (ctx, args) => view(await crashingEngineFor(ctx).resume(args.runId)),
  }),
  finishAndCleanEmail: actionGeneric({
    args: { emailId: v.string() },
    returns: v.number(),
    handler: async (ctx, args) => {
      // Cancel finishes the email now. A cleanup window of about a millisecond makes it expire at
      // once, standing in for a recovery that comes after `cleanupAfterDays`.
      await ctx.runMutation(component().lib.cancel, args);
      await ctx.runMutation(component().lib.setConfig, { config: { cleanupAfterDays: 1e-8 } });
      await new Promise((resolve) => setTimeout(resolve, 5));

      // convex-test lets the app call the component's internal cleanup, which the cron runs in production.
      return await ctx.runMutation(component().lib.cleanupExpiredEmails, { limit: 50 });
    },
  }),
  resumeDue: actionGeneric({
    args: { limit: v.number() },
    returns: v.number(),
    handler: async (ctx, args) => await engineFor(ctx).resumeDue({ limit: args.limit }),
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
  startSendOnce: makeFunctionReference<"action", { runId: string }, { status: string; revision: number }>(
    "workflows:startSendOnce",
  ),
  resumeSendOnce: makeFunctionReference<"action", { runId: string }, { status: string; revision: number }>(
    "workflows:resumeSendOnce",
  ),
  finishAndCleanEmail: makeFunctionReference<"action", { emailId: string }, number>("workflows:finishAndCleanEmail"),
  start: makeFunctionReference<"action", { runId: string; email: string }, { status: string; revision: number }>(
    "workflows:start",
  ),
  resume: makeFunctionReference<"action", { runId: string }, { status: string; revision: number }>("workflows:resume"),
  sendEvent: makeFunctionReference<"action", { name: string; subject: string }, string[]>("workflows:sendEvent"),
  resumeDue: makeFunctionReference<"action", { limit: number }, number>("workflows:resumeDue"),
  startProto: makeFunctionReference<"action", { runId: string }, { status: string; revision: number }>(
    "workflows:startProto",
  ),
  startParked: makeFunctionReference<"action", { count: number; subject: string }, null>("workflows:startParked"),
  startStalled: makeFunctionReference<"action", { runId: string }, { status: string; revision: number }>(
    "workflows:startStalled",
  ),
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

  test("a lease-expiry job that finds the run waiting schedules nothing more", async () => {
    // convex-test runs jobs on real timers; a clock ahead of real time keeps them pending.
    clock.at = Date.now() + 86_400_000;

    const t = createApp();
    const startedAt = clock.at;

    await t.action(app.start, { runId: "run-3", email: "ada@example.test" });

    const run = await readRun(t, "run-3");

    expect(await pendingResumes(t)).toEqual([
      { at: startedAt + leaseMs, runId: "run-3" },
      { at: run.dueAt, runId: "run-3" },
    ]);

    clock.at += leaseMs;
    expect(await fireDueResumes(t)).toBe(1);
    expect(await pendingResumes(t)).toEqual([{ at: run.dueAt, runId: "run-3" }]);
    expect((await readRun(t, "run-3")).revision).toBe(run.revision);
  });

  test("a run whose action died mid-step is resumed by its lease-expiry job, with no resumeDue", async () => {
    clock.at = Date.now() + 86_400_000;
    stalled.calls = 0;

    const t = createApp();
    const startedAt = clock.at;
    const dead = t.action(app.startStalled, { runId: "run-5" });

    for (let tries = 0; tries < 200 && stalled.calls === 0; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    expect(stalled.calls).toBe(1);
    expect(await pendingResumes(t)).toEqual([{ at: startedAt + leaseMs, runId: "run-5" }]);

    clock.at += leaseMs;
    expect(await fireDueResumes(t)).toBe(1);
    expect(await readRun(t, "run-5")).toMatchObject({ status: "completed", journal: { charge: { result: 2 } } });

    stalled.release();
    expect(await dead).toMatchObject({ status: "completed" });
    expect(stalled.calls).toBe(2);
  });

  test("recovery after email cleanup reuses the queued email instead of queueing a second", async () => {
    clock.at = Date.now() + 86_400_000;
    crash.sends = 0;
    crash.emailIds = [];

    const t = createApp();
    const dead = t.action(app.startSendOnce, { runId: "run-6" });

    for (let tries = 0; tries < 200 && crash.sends === 0; tries += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5));
    }

    const [first] = crash.emailIds;

    if (first === undefined) throw new Error("The first execution queued no email.");

    expect(await t.action(app.finishAndCleanEmail, { emailId: first })).toBe(1);
    expect(await t.action(app.emailStatus, { emailId: first })).toBeNull();

    clock.at += leaseMs;
    expect(await t.action(app.resumeSendOnce, { runId: "run-6" })).toMatchObject({ status: "completed" });
    expect(crash.emailIds).toEqual([first, first]);
    expect((await readRun(t, "run-6")).journal.welcome).toMatchObject({ result: { id: first } });

    crash.release();
    await dead;
  });
});

/** The engine's default lease. */
const leaseMs = 5 * 60_000;

/**
 * Delivers every pending resume job due at the app clock, as the Convex scheduler would: each job is
 * marked canceled so its real timer can't run it again, then its action runs. Returns how many ran.
 */
async function fireDueResumes(t: ReturnType<typeof createApp>) {
  const due = await t.run(async (ctx) => {
    const runIds: string[] = [];

    for (const job of await ctx.db.system.query("_scheduled_functions").collect()) {
      if (job.name !== "workflows:resume" || job.state.kind !== "pending" || job.scheduledTime > clock.at) continue;

      await ctx.scheduler.cancel(job._id);
      runIds.push(z.object({ runId: z.string() }).parse(job.args[0]).runId);
    }

    return runIds;
  });

  for (const runId of due) await t.action(app.resume, { runId });

  return due.length;
}

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

  test("a __proto__ journal key would be dropped, so that step name fails the run instead of repeating", async () => {
    const run: WorkflowRun = {
      id: "run-1",
      workflow: "proto-step",
      version: 1,
      status: "waiting",
      input: null,
      journal: JSON.parse('{"__proto__":{"status":"completed","kind":"step","completedAt":1}}'),
      inbox: [],
      revision: 1,
      createdAt: 1,
      updatedAt: 1,
    };

    expect(Object.keys(parseWorkflowRun(JSON.stringify(run)).journal)).toEqual([]);

    clock.at = Date.parse("2026-01-01T00:00:00Z");
    protoCalls.count = 0;

    const t = createApp();

    expect(await t.action(app.startProto, { runId: "proto-1" })).toMatchObject({ status: "failed" });
    clock.at += 3_600_000;
    await t.action(app.resume, { runId: "proto-1" });
    expect((await readRun(t, "proto-1")).status).toBe("failed");
    expect(protoCalls.count).toBe(0);
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
    const queued: ConvexWorkflowSendArgs[] = [];

    const queue: ConvexWorkflowEmailQueue = {
      async sendWorkflowStep(_ctx, args) {
        queued.push(args);

        return "email-1";
      },
    };

    const sender = convexWorkflowEmail(queue, { runMutation: async () => null });

    await sender.send(
      message,
      {
        adapter: "backup",
        fallback: { adapters: ["third"] },
        retry: { maxAttempts: 2 },
        metadata: { userId: "u1", attempt: 1, skipped: undefined },
        idempotencyKey: "wf_1",
      },
      { runId: "run-1", step: "welcome" },
    );

    expect(queued).toEqual([
      {
        runId: "run-1",
        email: {
          ...message,
          adapter: "backup",
          fallbackAdapters: ["third"],
          maxAttempts: 2,
          sendMetadata: { userId: "u1", attempt: 1 },
          idempotencyKey: "wf_1",
        },
      },
    ]);
  });

  test("a send the queue can't carry fails the run on the first attempt, with no retry", async () => {
    const queued: ConvexWorkflowSendArgs[] = [];

    const queue: ConvexWorkflowEmailQueue = {
      async sendWorkflowStep(_ctx, args) {
        queued.push(args);

        return "email-1";
      },
    };

    const scheduled = defineWorkflow({
      name: "scheduled",
      run: async (ctx) => {
        await ctx.send("later", { ...message, sendAt: new Date(0) });
      },
    });

    const engine = createWorkflowEngine({
      email: convexWorkflowEmail(queue, { runMutation: async () => null }),
      store: createMemoryWorkflowStore(),
      clock: { now: () => 0 },
      workflows: [scheduled],
    });

    const run = await engine.start(scheduled, null, { id: "run-1" });

    expect(run.status).toBe("failed");
    expect(run.error).toEqual({ message: expect.stringContaining("sendAt"), step: "later" });
    expect(run.wait).toBeUndefined();
    expect(queued).toEqual([]);
  });

  test("refuses a send without the engine's run context", async () => {
    const queue: ConvexWorkflowEmailQueue = { sendWorkflowStep: async () => "email-1" };
    const sender = convexWorkflowEmail(queue, { runMutation: async () => null });

    expect(sender.send(message, { idempotencyKey: "wf_1" })).rejects.toThrow("run context");
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

const day = 86_400_000;

const workflowSend = {
  runId: "run-1",
  email: { from: "hello@acme.test", to: "ada@example.test", subject: "Welcome", text: "Hi", idempotencyKey: "wf_welcome" },
};

async function countRows(t: ReturnType<typeof convexTest>, table: "emails" | "workflowSends") {
  return await t.run(async (ctx) => (await ctx.db.query(table).collect()).length);
}

/** Moves an email to `sent`, finished `daysAgo` days ago, so cleanup sees it as expired. */
async function finishEmail(t: ReturnType<typeof convexTest>, emailId: string, daysAgo: number) {
  await t.run(async (ctx) => {
    const id = ctx.db.normalizeId("emails", emailId);

    if (!id) throw new Error(`No email ${emailId}.`);

    await ctx.db.patch(id, { status: "sent", terminalAt: Date.now() - daysAgo * day });
  });
}

describe("convex workflow send records", () => {
  test("a replayed send after email cleanup returns the original email and queues nothing", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.lib.setConfig, { config: { cleanupAfterDays: 1 } });

    const emailId = await t.mutation(api.workflows.enqueueSend, workflowSend);

    await finishEmail(t, emailId, 2);
    expect(await t.mutation(internal.lib.cleanupExpiredEmails, { limit: 50 })).toBe(1);
    expect(await countRows(t, "emails")).toBe(0);

    expect(await t.mutation(api.workflows.enqueueSend, workflowSend)).toBe(emailId);
    expect(await countRows(t, "emails")).toBe(0);
    expect(await countRows(t, "workflowSends")).toBe(1);
  });

  test("ordinary sends write no workflow send records", async () => {
    const t = convexTest(schema, modules);

    await t.mutation(api.lib.enqueue, { ...workflowSend.email, idempotencyKey: "plain" });
    await t.mutation(api.lib.enqueue, { from: "hello@acme.test", to: "ada@example.test", subject: "No key", text: "Hi" });

    expect(await countRows(t, "emails")).toBe(2);
    expect(await countRows(t, "workflowSends")).toBe(0);
  });

  test("records outlive email cleanup while the run is active and expire a retention window after it ends", async () => {
    const t = convexTest(schema, modules);
    const run = { runId: "run-1", workflow: "onboarding", status: "waiting", active: true, revision: 0, state: "{}" };

    await t.mutation(api.lib.setConfig, { config: { cleanupAfterDays: 1, workflowSendRetentionDays: 3 } });
    await t.mutation(api.workflows.createRun, { run });

    const emailId = await t.mutation(api.workflows.enqueueSend, workflowSend);

    await finishEmail(t, emailId, 400);
    await t.mutation(internal.lib.processDueEmails, { limit: 25 });
    expect(await countRows(t, "emails")).toBe(0);
    expect(await countRows(t, "workflowSends")).toBe(1);

    await t.mutation(api.workflows.saveRun, {
      run: { ...run, status: "completed", active: false, revision: 1 },
      expectedRevision: 0,
    });

    const released = await t.run(async (ctx) => (await ctx.db.query("workflowSends").first())?.releasedAt);

    expect(released).toBeNumber();

    // Inside the retention window the record stays; past it the sweep deletes it.
    await t.mutation(internal.lib.processDueEmails, { limit: 25 });
    expect(await countRows(t, "workflowSends")).toBe(1);

    await t.run(async (ctx) => {
      const send = await ctx.db.query("workflowSends").first();

      if (send) await ctx.db.patch(send._id, { releasedAt: Date.now() - 4 * day });
    });
    await t.mutation(internal.lib.processDueEmails, { limit: 25 });
    expect(await countRows(t, "workflowSends")).toBe(0);
  });
});

