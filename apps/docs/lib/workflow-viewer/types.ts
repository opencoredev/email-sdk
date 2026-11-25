import type { WorkflowInspectGraph, WorkflowRunTimeline } from "@opencoredev/email-sdk/workflows";

/** One keyframe of the sample run: the stored run as `describeRun` reports it at that moment. */
export type WorkflowViewerFrame = {
  /** Time since the run started. */
  atMs: number;
  label: string;
  timeline: WorkflowRunTimeline;
  /** The graph node the run is on: its current wait, or the end node once it finished. */
  activeNodeId: string;
  completedNodeIds: string[];
};

/** Everything the viewer renders, built while the page renders by `buildOnboardingViewerData`. */
export type WorkflowViewerData = {
  graph: WorkflowInspectGraph;
  mermaid: string;
  /** The path the sample run follows, as an id from `graph.paths`. */
  samplePathId: string;
  frames: WorkflowViewerFrame[];
};
