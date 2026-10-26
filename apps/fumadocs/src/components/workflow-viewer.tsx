/**
 * Interactive viewer for an inspected email workflow, built from the vendored Toolcraft
 * components in ./toolcraft. Definition mode draws every path `inspectWorkflow` found; Sample run
 * mode replays `describeRun` keyframes from a deterministic engine run. The data is a build-time
 * snapshot (src/lib/workflow-viewer/onboarding.generated.ts), so nothing runs in the browser.
 */
import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import {
  Ban,
  Braces,
  CalendarClock,
  Check,
  CircleCheck,
  CircleX,
  GitBranch,
  Hourglass,
  Mail,
  Play,
  Scissors,
  Workflow,
  Zap,
} from "lucide-react";
import type {
  WorkflowInspectNode,
  WorkflowInspectOutcome,
  WorkflowJsonValue,
  WorkflowRunTimelineEntry,
} from "@opencoredev/email-sdk/workflows";

import { cn } from "@/lib/cn";
import { layoutGraph, nodeHeight, nodeWidth } from "@/lib/workflow-viewer/layout";
import type { GraphLayout, PlacedNode } from "@/lib/workflow-viewer/layout";
import { onboardingViewerData } from "@/lib/workflow-viewer/onboarding.generated";
import type { WorkflowViewerData, WorkflowViewerFrame } from "@/lib/workflow-viewer/types";

import { Canvas } from "./toolcraft/canvas";
import { Keyframes } from "./toolcraft/keyframes";
import { LayersPanel } from "./toolcraft/layers-panel";
import type { LayerGroup, LayerItem } from "./toolcraft/layers-panel";
import { ControlRow, ControlSectionTitle, Panel } from "./toolcraft/panel";
import { SegmentedControl } from "./toolcraft/segmented-control";
import { Switch } from "./toolcraft/switch";
import { Toolbar, ToolbarDivider } from "./toolcraft/toolbar";

type Mode = "definition" | "run";

type NodeRunState = "completed" | "active" | "pending" | "off-path";

const day = 86_400_000;

const units = [
  ["w", 7 * day],
  ["d", day],
  ["h", 3_600_000],
  ["m", 60_000],
  ["s", 1_000],
] as const;

function formatDuration(ms: number) {
  if (ms === 0) return "0s";

  const parts: string[] = [];
  let rest = ms;

  for (const [unit, size] of units) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${unit}`);
      rest %= size;
    }
  }

  return parts.slice(0, 2).join(" ") || `${ms}ms`;
}

function formatOffset(ms: number) {
  return ms === 0 ? "Day 0" : `+${formatDuration(ms)}`;
}

function formatTimestamp(iso: string) {
  return `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;
}

/** How a node kind is labeled and drawn in the canvas, layers, and details. */
type NodeKindBadge = { label: string; icon: ReactNode };

function kindOf(node: WorkflowInspectNode): NodeKindBadge {
  switch (node.kind) {
    case "trigger":
      return { label: "Trigger", icon: <Zap /> };
    case "send":
      return { label: "Send email", icon: <Mail /> };
    case "sleep":
      return node.delay.kind === "until" ? { label: "Wait until", icon: <CalendarClock /> } : { label: "Delay", icon: <Hourglass /> };
    case "waitForEvent":
      return { label: "Wait for event", icon: <GitBranch /> };
    case "step":
      return { label: "Run step", icon: <Braces /> };
    case "end":
      return node.outcome.status === "completed"
        ? { label: "End", icon: <CircleCheck /> }
        : node.outcome.status === "failed"
          ? { label: "Failed", icon: <CircleX /> }
          : { label: "Cut off", icon: <Scissors /> };
    default: {
      const exhaustive: never = node;

      return exhaustive;
    }
  }
}

function titleOf(node: WorkflowInspectNode) {
  switch (node.kind) {
    case "trigger":
      return `${node.workflow} v${node.version}`;
    case "send":
      return node.email.subject;
    case "sleep":
      return node.delay.kind === "until" ? node.delay.at : `Wait ${formatDuration(node.delay.ms)}`;
    case "waitForEvent":
      return node.timeoutMs === undefined ? `"${node.event}"` : `"${node.event}" for up to ${formatDuration(node.timeoutMs)}`;
    case "step":
      return node.result.status === "mocked" ? "Result mocked" : "Result unknown";
    case "end":
      return node.outcome.status === "completed" ? outputSummary(node.outcome.output) : node.label;
    default: {
      const exhaustive: never = node;

      return exhaustive;
    }
  }
}

function outputSummary(output: WorkflowJsonValue | undefined) {
  return output === undefined ? "Completed" : `Completed · ${JSON.stringify(output)}`;
}

function layerName(node: WorkflowInspectNode) {
  return node.kind === "trigger" ? "trigger" : node.kind === "end" ? "end" : node.step;
}

function nodeRunState(id: string, frame: WorkflowViewerFrame, pathNodes: ReadonlySet<string>): NodeRunState {
  if (!pathNodes.has(id)) return "off-path";

  if (id === frame.activeNodeId && frame.timeline.wait) return "active";

  if (frame.completedNodeIds.includes(id)) return "completed";

  return id === frame.activeNodeId ? "active" : "pending";
}

/** Steps grouped the way the Layers panel shows them: shared steps first, then one group per branch. */
function layerGroups(layout: GraphLayout, mode: Mode, frame: WorkflowViewerFrame, pathNodes: ReadonlySet<string>): LayerGroup[] {
  const groups: LayerGroup[] = [];

  function item(placed: PlacedNode, depth: number): LayerItem {
    const state = nodeRunState(placed.node.id, frame, pathNodes);

    return {
      id: placed.node.id,
      name: layerName(placed.node),
      icon: kindOf(placed.node).icon,
      meta: formatOffset(placed.node.offsetMs),
      depth,
      muted: mode === "run" && state === "off-path",
      status:
        mode === "run" && state === "completed" ? (
          <Check aria-label="Done" className="size-3 text-[color:var(--accent)]" />
        ) : mode === "run" && state === "active" ? (
          <span aria-label="Current step" className="size-1.5 rounded-full bg-[color:var(--accent)]" role="img" />
        ) : undefined,
    };
  }

  function walk(id: string, group: LayerGroup) {
    const placed = layout.byId.get(id);

    if (!placed) return;

    group.items.push(item(placed, group.depth));

    const children = layout.childrenOf.get(id) ?? [];

    if (placed.node.kind === "waitForEvent" && children.length > 0) {
      const event = placed.node.event;
      const timeout = placed.node.timeoutMs;

      for (const child of children) {
        const branch = layout.edges.find((edge) => edge.from.node.id === id && edge.to.node.id === child)?.branch ?? "received";

        const label =
          branch === "received" ? `If "${event}" arrives` : `If no "${event}" within ${timeout === undefined ? "the wait" : formatDuration(timeout)}`;

        const next: LayerGroup = { id: `${id}:${branch}`, label, depth: group.depth + 1, items: [] };

        groups.push(next);
        walk(child, next);
      }

      return;
    }

    for (const child of children) walk(child, group);
  }

  const root: LayerGroup = { id: "root", label: "", depth: 0, items: [] };

  groups.push(root);
  walk(layout.nodes[0]?.node.id ?? "", root);

  return groups;
}

function WorkflowNodeCard({
  placed,
  selected,
  focusable,
  state,
  mode,
  onSelect,
  onKeyDown,
}: {
  placed: PlacedNode;
  selected: boolean;
  focusable: boolean;
  state: NodeRunState;
  mode: Mode;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}) {
  const { node } = placed;
  const kind = kindOf(node);
  const name = node.kind === "trigger" || node.kind === "end" ? undefined : node.step;
  const run = mode === "run";

  return (
    <button
      aria-pressed={selected}
      className={cn(
        "absolute flex cursor-pointer flex-col justify-center gap-1 rounded-[10px] border bg-[color:var(--node)] px-3 text-left outline-none transition-[border-color,opacity,box-shadow] duration-150 ease-out focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-2 focus-visible:outline-[color:var(--ring)]",
        selected
          ? "border-[color:var(--accent)] shadow-[0_0_0_1px_var(--accent)]"
          : "border-[color:color-mix(in_oklab,var(--border)_16%,transparent)] hover:border-[color:color-mix(in_oklab,var(--border)_32%,transparent)]",
        // Off-path and pending nodes dim by border and fill, not opacity, so their text keeps AA contrast.
        run && state === "off-path" && "border-dashed bg-transparent",
      )}
      data-node-id={node.id}
      onClick={onSelect}
      onKeyDown={onKeyDown}
      style={{ left: placed.x, top: placed.y, width: nodeWidth, height: nodeHeight }}
      tabIndex={focusable ? 0 : -1}
      type="button"
    >
      <span className="flex items-center gap-1.5 text-[11px] font-medium text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">
        <span aria-hidden="true" className="flex size-3.5 items-center justify-center text-[color:var(--accent)] [&_svg]:size-3.5">
          {kind.icon}
        </span>
        {kind.label}
        {name ? <span className="ml-auto truncate font-mono text-[10.5px] text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">{name}</span> : null}
      </span>
      <span
        className={cn(
          "truncate text-[13px] font-medium",
          run && (state === "pending" || state === "off-path") ? "text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]" : "text-[color:var(--foreground)]",
        )}
      >
        {titleOf(node)}
      </span>
      {run && state === "completed" ? (
        <span className="absolute -top-2 -right-2 flex size-5 items-center justify-center rounded-full bg-[color:var(--accent)] text-[color:var(--accent-foreground)]">
          <Check aria-hidden="true" className="size-3" strokeWidth={3} />
          <span className="sr-only">Done</span>
        </span>
      ) : null}
      {run && state === "active" ? (
        <span className="absolute -top-3.5 right-2 rounded-full bg-[color:var(--accent)] px-1.5 py-px text-[10px] leading-4 font-semibold text-[color:var(--accent-foreground)]">
          Waiting here
        </span>
      ) : null}
    </button>
  );
}

function GraphCanvas({
  data,
  layout,
  mode,
  frame,
  pathNodes,
  selectedId,
  onSelect,
}: {
  data: WorkflowViewerData;
  layout: GraphLayout;
  mode: Mode;
  frame: WorkflowViewerFrame;
  pathNodes: ReadonlySet<string>;
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  const selected = layout.byId.get(selectedId);

  function onNodeKeyDown(event: KeyboardEvent<HTMLButtonElement>, id: string) {
    const parent = layout.parentOf.get(id);
    const siblings = parent === undefined ? [id] : (layout.childrenOf.get(parent) ?? [id]);
    const index = siblings.indexOf(id);

    const next =
      event.key === "ArrowDown"
        ? layout.childrenOf.get(id)?.[0]
        : event.key === "ArrowUp"
          ? parent
          : event.key === "ArrowRight"
            ? siblings[index + 1]
            : event.key === "ArrowLeft"
              ? siblings[index - 1]
              : undefined;

    if (next === undefined) return;

    event.preventDefault();
    event.stopPropagation();
    onSelect(next);
    event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-node-id="${CSS.escape(next)}"]`)?.focus();
  }

  const reached = (id: string) => frame.completedNodeIds.includes(id) || id === frame.activeNodeId;

  return (
    <Canvas
      className="h-[360px] lg:h-full"
      height={layout.height}
      label={`${data.graph.workflow} workflow graph`}
      revealRect={selected ? { x: selected.x, y: selected.y, width: nodeWidth, height: nodeHeight } : undefined}
      width={layout.width}
    >
      <svg aria-hidden="true" className="absolute inset-0 overflow-visible" height={layout.height} width={layout.width}>
        <defs>
          <marker id="workflow-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="6" refY="4" viewBox="0 0 8 8">
            <path d="M1 1L6 4L1 7" fill="none" stroke="context-stroke" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" />
          </marker>
        </defs>
        {layout.edges.map((edge) => {
          const x1 = edge.from.x + nodeWidth / 2;
          const y1 = edge.from.y + nodeHeight;
          const x2 = edge.to.x + nodeWidth / 2;
          const y2 = edge.to.y - 3;
          const mid = (y1 + y2) / 2;
          const lit = mode === "run" && pathNodes.has(edge.to.node.id) && reached(edge.to.node.id);

          return (
            <path
              d={`M ${x1} ${y1} C ${x1} ${mid} ${x2} ${mid} ${x2} ${y2}`}
              fill="none"
              key={`${edge.from.node.id}->${edge.to.node.id}`}
              markerEnd="url(#workflow-arrow)"
              stroke={lit ? "var(--accent)" : "color-mix(in oklab, var(--foreground) 30%, transparent)"}
              strokeWidth={lit ? 2 : 1.25}
            />
          );
        })}
      </svg>
      {layout.edges.flatMap((edge) =>
        edge.branch
          ? [
              <span
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 rounded-full border bg-[color:var(--panel)] px-2 py-0.5 font-mono text-[10.5px] whitespace-nowrap",
                  edge.branch === "received"
                    ? "border-[color:color-mix(in_oklab,var(--accent)_45%,transparent)] text-[color:var(--foreground)]"
                    : "border-[color:color-mix(in_oklab,var(--border)_20%,transparent)] text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]",
                )}
                key={`${edge.to.node.id}:label`}
                style={{ left: (edge.from.x + edge.to.x) / 2 + nodeWidth / 2, top: (edge.from.y + nodeHeight + edge.to.y) / 2 }}
              >
                {edge.branch === "received" ? "received" : `timeout${edge.from.node.kind === "waitForEvent" && edge.from.node.timeoutMs !== undefined ? ` · ${formatDuration(edge.from.node.timeoutMs)}` : ""}`}
              </span>,
            ]
          : [],
      )}
      {layout.nodes.map((placed) => (
        <WorkflowNodeCard
          focusable={placed.node.id === selectedId}
          key={placed.node.id}
          mode={mode}
          onKeyDown={(event) => onNodeKeyDown(event, placed.node.id)}
          onSelect={() => onSelect(placed.node.id)}
          placed={placed}
          selected={placed.node.id === selectedId}
          state={nodeRunState(placed.node.id, frame, pathNodes)}
        />
      ))}
    </Canvas>
  );
}

function JsonBlock({ value }: { value: WorkflowJsonValue | WorkflowInspectOutcome }) {
  return (
    <pre className="m-0 max-h-48 overflow-auto rounded-md bg-[color:color-mix(in_oklab,var(--foreground)_5%,transparent)] p-2 font-mono text-[11px] leading-relaxed text-[color:var(--foreground)]">
      {JSON.stringify(value, null, 2)}
    </pre>
  );
}

function EmailPreview({ email }: { email: Extract<WorkflowInspectNode, { kind: "send" }>["email"] }) {
  const [plain, setPlain] = useState(email.html === undefined);

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <ControlSectionTitle>Preview</ControlSectionTitle>
        {email.html !== undefined && email.text !== undefined ? <Switch checked={plain} label="Plain text" onCheckedChange={setPlain} /> : null}
      </div>
      {plain || email.html === undefined ? (
        <pre className="m-0 min-h-40 rounded-lg border border-[color:color-mix(in_oklab,var(--border)_12%,transparent)] p-3 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap text-[color:var(--foreground)]">
          {email.text}
        </pre>
      ) : (
        <iframe
          className="h-72 w-full rounded-lg border border-[color:color-mix(in_oklab,var(--border)_12%,transparent)] bg-white"
          sandbox=""
          srcDoc={email.html}
          title={`Email preview: ${email.subject}`}
        />
      )}
    </div>
  );
}

function RunStatus({ entry, state }: { entry: WorkflowRunTimelineEntry | undefined; state: NodeRunState }) {
  if (state === "off-path") return <ControlRow label="Run">Not taken on this run</ControlRow>;

  if (!entry) return <ControlRow label="Run">{state === "completed" ? "Done" : "Not reached yet"}</ControlRow>;

  switch (entry.status) {
    case "completed":
      return (
        <>
          <ControlRow label="Run">{entry.summary}</ControlRow>
          <ControlRow label="At">{formatTimestamp(entry.completedAt)}</ControlRow>
        </>
      );
    case "waiting":
      return (
        <>
          <ControlRow label="Run">Waiting{entry.event ? ` for "${entry.event}"` : ""}</ControlRow>
          {entry.until ? <ControlRow label="Deadline">{formatTimestamp(entry.until)}</ControlRow> : null}
        </>
      );
    case "retrying":
      return <ControlRow label="Run">{`Retrying after ${entry.attempts} failed attempts: ${entry.lastError}`}</ControlRow>;
    default: {
      const exhaustive: never = entry;

      return exhaustive;
    }
  }
}

function NodeDetails({
  node,
  cancelOn,
  layout,
  mode,
  frame,
  state,
  onSelect,
}: {
  node: WorkflowInspectNode;
  cancelOn: readonly string[];
  layout: GraphLayout;
  mode: Mode;
  frame: WorkflowViewerFrame;
  state: NodeRunState;
  onSelect: (id: string) => void;
}) {
  const kind = kindOf(node);
  const step = node.kind === "trigger" || node.kind === "end" ? undefined : node.step;
  const entry = step === undefined ? undefined : frame.timeline.entries.find((item) => item.step === step);

  return (
    <div className="flex flex-col gap-4 p-3">
      <div>
        <p className="m-0 flex items-center gap-1.5 text-[11px] font-medium text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">
          <span aria-hidden="true" className="text-[color:var(--accent)] [&_svg]:size-3.5">
            {kind.icon}
          </span>
          {kind.label}
        </p>
        <p className="m-0 mt-1 text-sm font-semibold text-[color:var(--foreground)]">{titleOf(node)}</p>
      </div>
      <dl className="m-0">
        {step ? <ControlRow label="Step">
            <code className="font-mono">{step}</code>
          </ControlRow> : null}
        <ControlRow label="Starts">{node.offsetMs === 0 ? "At signup" : `${formatDuration(node.offsetMs)} after start`}</ControlRow>
        {node.kind === "send" ? (
          <>
            <ControlRow label="From">{node.email.from}</ControlRow>
            <ControlRow label="To">{node.email.to.join(", ")}</ControlRow>
            {node.email.cc.length > 0 ? <ControlRow label="Cc">{node.email.cc.join(", ")}</ControlRow> : null}
            <ControlRow label="Subject">{node.email.subject}</ControlRow>
          </>
        ) : null}
        {node.kind === "sleep" ? (
          <ControlRow label={node.delay.kind === "until" ? "Until" : "Duration"}>
            {node.delay.kind === "until" ? `${node.delay.at} (${formatDuration(node.delay.ms)})` : formatDuration(node.delay.ms)}
          </ControlRow>
        ) : null}
        {node.kind === "waitForEvent" ? (
          <>
            <ControlRow label="Event">
              <code className="font-mono">{node.event}</code>
            </ControlRow>
            <ControlRow label="Timeout">{node.timeoutMs === undefined ? "None: waits until canceled" : formatDuration(node.timeoutMs)}</ControlRow>
          </>
        ) : null}
        {node.kind === "trigger" ? (
          <>
            <ControlRow label="Workflow">{`${node.workflow} v${node.version}`}</ControlRow>
            <ControlRow label="Cancels on">{cancelOn.length > 0 ? cancelOn.join(", ") : "Nothing"}</ControlRow>
          </>
        ) : null}
        {mode === "run" ? <RunStatus entry={entry} state={state} /> : null}
      </dl>
      {node.kind === "send" ? <EmailPreview email={node.email} key={node.id} /> : null}
      {node.kind === "waitForEvent" ? (
        <div>
          <ControlSectionTitle>Branches</ControlSectionTitle>
          <div className="flex flex-col gap-1">
            {(layout.childrenOf.get(node.id) ?? []).map((child) => {
              const target = layout.byId.get(child);
              const branch = layout.edges.find((edge) => edge.from.node.id === node.id && edge.to.node.id === child)?.branch;

              return target ? (
                <button
                  className="flex cursor-pointer items-center justify-between gap-2 rounded-md border border-[color:color-mix(in_oklab,var(--border)_12%,transparent)] px-2 py-1.5 text-left text-xs text-[color:var(--foreground)] outline-none hover:bg-[color:color-mix(in_oklab,var(--foreground)_6%,transparent)] focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-[color:var(--ring)]"
                  key={child}
                  onClick={() => onSelect(child)}
                  type="button"
                >
                  <span className="font-mono text-[11px] text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">{branch}</span>
                  <span className="truncate">{titleOf(target.node)}</span>
                </button>
              ) : null;
            })}
          </div>
        </div>
      ) : null}
      {node.kind === "trigger" ? (
        <div>
          <ControlSectionTitle>Sample input</ControlSectionTitle>
          <JsonBlock value={node.input} />
        </div>
      ) : null}
      {node.kind === "step" ? (
        <div>
          <ControlSectionTitle>{node.result.status === "mocked" ? "Mocked result" : "Result"}</ControlSectionTitle>
          {node.result.status === "mocked" ? (
            <JsonBlock value={node.result.value} />
          ) : (
            <p className="m-0 text-xs text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">No mock in steps, so the inspector returned undefined.</p>
          )}
        </div>
      ) : null}
      {node.kind === "end" ? (
        <div>
          <ControlSectionTitle>Outcome</ControlSectionTitle>
          <JsonBlock value={node.outcome} />
        </div>
      ) : null}
    </div>
  );
}

function RunEntries({ frame }: { frame: WorkflowViewerFrame }) {
  return (
    <div className="px-3 pb-3">
      <ol className="m-0 flex list-none flex-col p-0 sm:hidden">
        {frame.timeline.entries.map((entry) => (
          <li className="flex flex-col gap-0.5 border-t border-[color:color-mix(in_oklab,var(--border)_10%,transparent)] py-2 text-xs" key={entry.step}>
            <span className="flex items-center justify-between gap-2">
              <span className="font-mono text-[color:var(--foreground)]">{entry.step}</span>
              <span className={cn("inline-flex items-center gap-1", entry.status === "waiting" && "font-medium text-[color:var(--accent)]")}>
                {entry.status === "completed" ? <Check aria-hidden="true" className="size-3" /> : <Hourglass aria-hidden="true" className="size-3" />}
                {entry.status}
              </span>
            </span>
            <span className="text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">
              {entry.status === "completed"
                ? `${entry.summary} · ${formatTimestamp(entry.completedAt)}`
                : entry.status === "waiting"
                  ? `${entry.kind}${entry.until ? ` until ${formatTimestamp(entry.until)}` : ""}`
                  : entry.lastError}
            </span>
          </li>
        ))}
      </ol>
      <table className="hidden w-full border-collapse text-left text-xs sm:table">
        <caption className="sr-only">describeRun entries at this keyframe</caption>
        <thead>
          <tr className="text-[11px] text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">
            <th className="py-1 pr-3 font-medium" scope="col">Step</th>
            <th className="py-1 pr-3 font-medium" scope="col">Kind</th>
            <th className="py-1 pr-3 font-medium" scope="col">Status</th>
            <th className="py-1 pr-3 font-medium" scope="col">Time</th>
            <th className="py-1 font-medium" scope="col">Summary</th>
          </tr>
        </thead>
        <tbody>
          {frame.timeline.entries.map((entry) => (
            <tr className="border-t border-[color:color-mix(in_oklab,var(--border)_10%,transparent)] text-[color:var(--foreground)]" key={entry.step}>
              <td className="py-1.5 pr-3 font-mono">{entry.step}</td>
              <td className="py-1.5 pr-3">{entry.kind}</td>
              <td className="py-1.5 pr-3">
                <span className={cn("inline-flex items-center gap-1", entry.status === "waiting" && "font-medium text-[color:var(--accent)]")}>
                  {entry.status === "completed" ? <Check aria-hidden="true" className="size-3" /> : <Hourglass aria-hidden="true" className="size-3" />}
                  {entry.status}
                </span>
              </td>
              <td className="py-1.5 pr-3 font-mono tabular-nums whitespace-nowrap">
                {entry.status === "completed" ? formatTimestamp(entry.completedAt) : entry.status === "waiting" && entry.until ? `until ${formatTimestamp(entry.until)}` : ""}
              </td>
              <td className="py-1.5 text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">
                {entry.status === "completed" ? entry.summary : entry.status === "retrying" ? entry.lastError : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="m-0 mt-2 text-[11px] text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">
        Run <code className="font-mono">{frame.timeline.runId}</code> is <span className="font-medium text-[color:var(--foreground)]">{frame.timeline.status}</span>
        {frame.timeline.output !== undefined ? ` with output ${JSON.stringify(frame.timeline.output)}` : ""}.
      </p>
    </div>
  );
}

const playbackMs = 1800;

/** The onboarding drip from the email workflows guide, inspected at build time. */
export function WorkflowViewer({ data = onboardingViewerData }: { data?: WorkflowViewerData }) {
  const layout = useMemo(() => layoutGraph(data.graph), [data]);
  const samplePath = data.graph.paths.find((path) => path.id === data.samplePathId);
  const pathNodes = useMemo(() => new Set(samplePath?.nodes ?? []), [samplePath]);
  const [mode, setMode] = useState<Mode>("definition");
  const [selectedId, setSelectedId] = useState(() => data.graph.nodes.find((node) => node.kind === "send")?.id ?? data.graph.nodes[0]?.id ?? "");
  const [frameIndex, setFrameIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const frame = data.frames[frameIndex] ?? data.frames[0];

  useEffect(() => {
    if (!playing) return;

    if (frameIndex >= data.frames.length - 1) {
      setPlaying(false);

      return;
    }

    const timer = window.setTimeout(() => setFrameIndex((index) => index + 1), playbackMs);

    return () => window.clearTimeout(timer);
  }, [playing, frameIndex, data.frames.length]);

  useEffect(() => {
    if (mode === "run" && frame) setSelectedId(frame.activeNodeId);
  }, [mode, frame]);

  if (!frame) return null;

  const selected = layout.byId.get(selectedId)?.node ?? data.graph.nodes[0];
  const lastAt = Math.max(samplePath?.durationMs ?? 0, ...data.frames.map((item) => item.atMs), ...data.graph.paths.map((path) => path.durationMs));
  const ticks = Array.from({ length: Math.floor(lastAt / day) + 1 }, (_, index) => ({ atMs: index * day, label: `d${index}` }));

  return (
    <div
      className="toolcraft not-prose my-6 flex flex-col overflow-hidden rounded-[12px] border border-[color:color-mix(in_oklab,var(--border)_14%,transparent)] bg-[color:var(--panel)] text-[color:var(--foreground)]"
      data-workflow-viewer=""
    >
      <Toolbar className="order-0 border-b border-[color:color-mix(in_oklab,var(--border)_10%,transparent)]" label="Workflow viewer">
        <span className="flex min-w-0 items-center gap-1.5 px-1 text-xs font-semibold">
          <Workflow aria-hidden="true" className="size-3.5 text-[color:var(--accent)]" />
          <span className="font-mono">{data.graph.workflow}</span>
          <span className="font-normal text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">v{data.graph.version}</span>
        </span>
        <ToolbarDivider />
        <span className="text-[11px] text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">
          {data.graph.paths.length} paths · {data.graph.nodes.filter((node) => node.kind === "send").length} emails
        </span>
        {data.graph.cancelOn.length > 0 ? (
          <>
            <ToolbarDivider />
            <span className="flex items-center gap-1.5 text-[11px] text-[color:color-mix(in_oklab,var(--foreground)_72%,transparent)]">
              <Ban aria-hidden="true" className="size-3 text-[color:var(--destructive)]" />
              Cancels on <code className="font-mono text-[color:var(--foreground)]">{data.graph.cancelOn.join(", ")}</code>
            </span>
          </>
        ) : null}
        <SegmentedControl
          ariaLabel="View"
          className="ml-auto"
          onValueChange={(next) => {
            setMode(next);
            setPlaying(false);
          }}
          options={[
            { value: "definition", label: "Definition", icon: <GitBranch aria-hidden="true" /> },
            { value: "run", label: "Sample run", icon: <Play aria-hidden="true" /> },
          ]}
          value={mode}
        />
      </Toolbar>
      {mode === "run" ? (
        <Panel bodyClassName="overflow-visible" className="order-1 border-b border-[color:color-mix(in_oklab,var(--border)_10%,transparent)] lg:order-3 lg:border-t lg:border-b-0" title="Sample run · describeRun">
          <Keyframes
            currentIndex={frameIndex}
            durationMs={lastAt}
            formatTime={(ms) => (ms === 0 ? "d0" : `d${Math.round((ms / day) * 10) / 10}`)}
            keyframes={data.frames.map((item, index) => ({ id: `frame-${index}`, atMs: item.atMs, label: item.label }))}
            label="Sample run keyframes"
            onCurrentIndexChange={setFrameIndex}
            onPlayingChange={setPlaying}
            playing={playing}
            ticks={ticks}
          />
          <RunEntries frame={frame} />
        </Panel>
      ) : null}
      <div className="order-2 grid grid-cols-1 lg:h-[580px] lg:grid-cols-[220px_minmax(0,1fr)_320px]">
        <Panel className="order-2 border-t border-[color:color-mix(in_oklab,var(--border)_10%,transparent)] lg:order-1 lg:border-t-0 lg:border-r" title="Steps">
          <LayersPanel groups={layerGroups(layout, mode, frame, pathNodes)} label="Workflow steps" onSelect={setSelectedId} selectedId={selectedId} />
        </Panel>
        <div className="order-1 min-h-0 bg-[color:var(--background)] lg:order-2">
          <GraphCanvas data={data} frame={frame} layout={layout} mode={mode} onSelect={setSelectedId} pathNodes={pathNodes} selectedId={selectedId} />
        </div>
        <Panel className="order-3 border-t border-[color:color-mix(in_oklab,var(--border)_10%,transparent)] lg:border-t-0 lg:border-l" title="Details">
          {selected ? (
            <NodeDetails
              cancelOn={data.graph.cancelOn}
              frame={frame}
              layout={layout}
              mode={mode}
              node={selected}
              onSelect={setSelectedId}
              state={nodeRunState(selected.id, frame, pathNodes)}
            />
          ) : null}
        </Panel>
      </div>
    </div>
  );
}
