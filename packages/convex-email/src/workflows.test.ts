import { describe, expect, test } from "bun:test";
import { createWorkflowEngine, defineWorkflow } from "@opencoredev/email-sdk/workflows";
import type { WorkflowRun } from "@opencoredev/email-sdk/workflows";
import { actionGeneric, componentsGeneric, defineSchema, makeFunctionReference } from "convex/server";
import type { GenericActionCtx, GenericDataModel } from "convex/server";
import { v } from "convex/values";
import { convexTest } from "convex-test";
import { z } from "zod";

import { ConvexEmail } from "./client/index.js";
import { convexWorkflowEmail, convexWorkflowScheduler, convexWorkflowStore, toConvexSendArgs } from "./client/workflows.js";
import { api } from "./component/_generated/api.js";
import schema from "./component/schema.js";
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

/** The app's clock. Tests move it instead of waiting, and the engine reads it through `clock`. */
const clock = { at: Date.parse("2026-01-01T00:00:00Z") };

const resumeRef = makeFunctionReference<"action", { runId: string }>("workflows:resume");

function engineFor(ctx: GenericActionCtx<GenericDataModel>) {
  return createWorkflowEngine({
    email: convexWorkflowEmail(email, ctx),
    store: convexWorkflowStore(component(), ctx),
    scheduler: convexWorkflowScheduler(ctx, resumeRef),
    clock: { now: () => clock.at },
    workflows: [onboarding],
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

    expect(await t.query(api.workflows.listDueRuns, { now: 100, limit: 10 })).toEqual(["run-1"]);
    expect((await t.query(api.workflows.listDueRuns, { now: 1_000, limit: 10 })).sort()).toEqual(["later", "run-1"]);

    const active = await t.query(api.workflows.listActiveRunsBySubject, { subject: "ada@example.test" });

    expect(active.map((run) => run.runId).sort()).toEqual(["event-wait", "later", "run-1"]);
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
      ["Welcome", "wf:run-1:welcome"],
      ["Thanks for activating", "wf:run-1:follow-up"],
    ]);
  });
});

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
        "wf:run-1:welcome",
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
      toConvexSendArgs({ from: "a@acme.test", to: "b@acme.test", subject: "Hi", text: "Hi", sendAt: new Date() }, undefined),
    ).toThrow("sendAt");
    expect(() =>
      toConvexSendArgs(
        { from: "a@acme.test", to: "b@acme.test", subject: "Hi", text: "Hi", attachments: [{ filename: "a.bin", content: new Uint8Array([1]) }] },
        undefined,
      ),
    ).toThrow("string content");
  });
});
