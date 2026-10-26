/**
 * Builds the viewer snapshot: the inspected graph, its Mermaid source, and keyframes from a
 * deterministic in-memory engine run on a manual clock. Build-time only; see
 * scripts/generate-workflow-viewer.ts.
 */
import {
  createManualClock,
  createMemoryWorkflowScheduler,
  createMemoryWorkflowStore,
  createWorkflowEngine,
  describeRun,
  inspectWorkflow,
  toMermaid,
} from "@opencoredev/email-sdk/workflows";
import type { WorkflowInspectGraph, WorkflowInspectPath, WorkflowRun } from "@opencoredev/email-sdk/workflows";

import { onboarding, onboardingSample } from "./onboarding-workflow";
import type { WorkflowViewerData, WorkflowViewerFrame } from "./types";

const runStart = Date.parse("2026-03-02T09:00:00Z");

function nodeIdForStep(graph: WorkflowInspectGraph, path: WorkflowInspectPath, step: string) {
  return path.nodes.find((id) => graph.nodes.some((node) => node.id === id && "step" in node && node.step === step));
}

function frameFor(graph: WorkflowInspectGraph, path: WorkflowInspectPath, run: WorkflowRun, label: string): WorkflowViewerFrame {
  const timeline = describeRun(run);
  const triggerId = path.nodes[0] ?? "";
  const endId = path.nodes.at(-1) ?? triggerId;

  const completedNodeIds = [
    triggerId,
    ...timeline.entries.flatMap((entry) => {
      const id = entry.status === "completed" ? nodeIdForStep(graph, path, entry.step) : undefined;

      return id === undefined ? [] : [id];
    }),
  ];

  const waitingOn = timeline.wait ? nodeIdForStep(graph, path, timeline.wait.step) : undefined;

  if (!timeline.wait) completedNodeIds.push(endId);

  return { atMs: run.updatedAt - runStart, label, timeline, activeNodeId: waitingOn ?? endId, completedNodeIds };
}

export async function buildOnboardingViewerData(): Promise<WorkflowViewerData> {
  const graph = await inspectWorkflow(onboarding, {
    input: onboardingSample.input,
    events: onboardingSample.events,
    steps: onboardingSample.steps,
    subject: onboardingSample.input.email,
    startedAt: runStart,
  });

  const found = graph.paths.find((item) => item.choices.every((choice) => choice.branch === "received"));

  if (!found) throw new Error("The onboarding graph has no all-received path.");

  const path: WorkflowInspectPath = found;

  const clock = createManualClock(runStart);
  const scheduler = createMemoryWorkflowScheduler(clock);
  let sent = 0;

  const engine = createWorkflowEngine({
    email: { send: async () => ({ adapter: "resend", id: `re_sample_${(sent += 1)}` }) },
    store: createMemoryWorkflowStore(),
    scheduler,
    clock,
    workflows: [onboarding],
  });

  const runId = `onboarding:${onboardingSample.input.userId}`;
  const frames: WorkflowViewerFrame[] = [];

  async function capture(label: string) {
    const run = await engine.get(runId);

    if (!run) throw new Error(`Run ${runId} is missing.`);

    frames.push(frameFor(graph, path, run, label));
  }

  await engine.start(onboarding, onboardingSample.input, { id: runId, subject: onboardingSample.input.email });
  await capture("Signup: welcome sent, sleeping 2 days");
  await scheduler.advance("2d", engine);
  await capture("Day 2: tip sent, waiting up to 3 days for activation");
  await scheduler.advance("1d", engine);
  await engine.sendEvent({ name: "activated", subject: onboardingSample.input.email, payload: onboardingSample.events.activated });
  await capture("Day 3: activated, confirmation sent, run completed");

  return { graph, mermaid: toMermaid(graph), samplePathId: path.id, frames };
}
