import { expect, test } from "bun:test";
import { createEmailClient } from "@opencoredev/email-sdk";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";
import {
  createManualClock,
  createMemoryWorkflowScheduler,
  createMemoryWorkflowStore,
  createWorkflowEngine,
} from "@opencoredev/email-sdk/workflows";

import { markActivated, onboarding, startOnboarding, unsubscribe } from "./onboarding.js";

function harness() {
  const adapter = memoryAdapter();
  const clock = createManualClock(Date.parse("2026-03-02T09:00:00Z"));
  const scheduler = createMemoryWorkflowScheduler(clock);

  const engine = createWorkflowEngine({
    email: createEmailClient({ adapters: [adapter], telemetry: false }),
    store: createMemoryWorkflowStore(),
    scheduler,
    clock,
    workflows: [onboarding],
  });

  const subjects = () => adapter.raw?.sent.map((sent) => sent.message.subject);

  return { engine, scheduler, subjects };
}

const ada = { userId: "u_1", email: "ada@example.com", name: "Ada" };

test("a user who never activates gets welcome, tip, and nudge", async () => {
  const { engine, scheduler, subjects } = harness();

  await startOnboarding(engine, ada);
  await startOnboarding(engine, ada);
  expect(subjects()).toEqual(["Welcome, Ada"]);

  await scheduler.advance("2d", engine);
  expect(subjects()).toEqual(["Welcome, Ada", "One tip to get started"]);

  await scheduler.advance("3d", engine);
  expect(subjects()).toEqual(["Welcome, Ada", "One tip to get started", "Need a hand?"]);
  expect((await engine.get("onboarding:u_1"))?.output).toEqual({ outcome: "nudged" });
});

test("activating after the tip skips the nudge", async () => {
  const { engine, scheduler, subjects } = harness();

  await startOnboarding(engine, ada);
  await scheduler.advance("2d", engine);
  await scheduler.advance("1d", engine);
  await markActivated(engine, ada.email, "pro");

  expect(subjects()).toEqual(["Welcome, Ada", "One tip to get started", "You're all set"]);
});

test("unsubscribing during the first wait stops the drip", async () => {
  const { engine, scheduler, subjects } = harness();

  await startOnboarding(engine, ada);
  await unsubscribe(engine, ada.email);
  await scheduler.advance("7d", engine);

  expect(subjects()).toEqual(["Welcome, Ada"]);
  expect((await engine.get("onboarding:u_1"))?.status).toBe("canceled");
});
