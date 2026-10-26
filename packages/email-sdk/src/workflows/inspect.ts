import { isObjectLike, isString, isStringMember } from "../internal/decode.js";
import type { EmailAddress, EmailMessage, OneOrMany } from "../types.js";
import { durationToMs } from "./duration.js";
import { WorkflowError } from "./errors.js";
import { stepNameError, stepOverlapError } from "./step-name.js";
import type {
  AnyWorkflowDefinition,
  WorkflowContext,
  WorkflowDuration,
  WorkflowJsonValue,
  WorkflowRun,
  WorkflowRunStatus,
  WorkflowSendRecord,
  WorkflowStepKind,
  WorkflowStepRecord,
} from "./types.js";

/** Options for `inspectWorkflow`. Nothing is sent, stored, or scheduled. */
export type WorkflowInspectOptions = {
  /** Start input, parsed by the definition's input schema exactly as `engine.start` would. */
  input: WorkflowJsonValue;
  /** Results for `ctx.step` calls, by step name. A step without one is recorded as `unknown`. */
  steps?: Readonly<Record<string, WorkflowJsonValue>>;
  /** Sample payloads for `ctx.waitForEvent`, by event name, used on the `received` branch. */
  events?: Readonly<Record<string, WorkflowJsonValue>>;
  /** Passed to the workflow as `ctx.subject`. */
  subject?: string;
  /** Epoch milliseconds used as `ctx.startedAt` and as the base for `sleepUntil`. Defaults to 0. */
  startedAt?: number;
  /** Most paths to explore. Each timed `waitForEvent` can double the count. Defaults to 32. */
  maxPaths?: number;
  /** Most `ctx` calls in one path before it is cut off. Defaults to 100. */
  maxDepth?: number;
};

/** A rendered email from a `ctx.send` call, with every address list formatted as strings. */
export type WorkflowInspectEmail = {
  from: string;
  to: string[];
  cc: string[];
  bcc: string[];
  replyTo: string[];
  subject: string;
  text?: string;
  html?: string;
};

/** How long a `sleep` or `sleepUntil` node pauses the run. */
export type WorkflowInspectDelay =
  | { kind: "duration"; ms: number }
  | { kind: "until"; at: string; ms: number };

/** What a `ctx.step` node returned: the caller's mock from `options.steps`, or nothing known. */
export type WorkflowInspectStepResult = { status: "mocked"; value: WorkflowJsonValue } | { status: "unknown" };

/**
 * How a path ended: the workflow returned, threw, or hit a cap. `canceled` never appears here,
 * because cancellation comes from outside the definition; see the graph's `cancelOn`.
 */
export type WorkflowInspectOutcome =
  | { status: "completed"; output?: WorkflowJsonValue }
  | { status: "failed"; error: string }
  | { status: "truncated"; reason: string };

type NodeBase = {
  /**
   * Stable id: the step name, prefixed with the branch choices that lead to it, as in
   * `activated:timeout/nudge`. Step names and the steps in the prefix are URI-encoded, so `:` and
   * `/` only ever separate. The trigger is `$trigger` and each end node is its prefix plus `$end`;
   * an encoded step name never contains `$`, so no step can take either id.
   */
  id: string;
  /** A one-line, human-readable description of the node. */
  label: string;
  /** Time from the start of the run until this node begins, assuming events arrive at once. */
  offsetMs: number;
};

/** One node of an inspected workflow graph. Every ctx call becomes one node. */
export type WorkflowInspectNode =
  | (NodeBase & { kind: "trigger"; workflow: string; version: number; input: WorkflowJsonValue })
  | (NodeBase & { kind: "send"; step: string; email: WorkflowInspectEmail })
  | (NodeBase & { kind: "sleep"; step: string; delay: WorkflowInspectDelay })
  | (NodeBase & { kind: "waitForEvent"; step: string; event: string; timeoutMs?: number })
  | (NodeBase & { kind: "step"; step: string; result: WorkflowInspectStepResult })
  | (NodeBase & { kind: "end"; outcome: WorkflowInspectOutcome });

/** Which way a timed event wait went on a path. */
export type WorkflowInspectBranch = "received" | "timeout";

/** A directed edge. Edges leaving a `waitForEvent` node carry the branch they stand for. */
export type WorkflowInspectEdge = { from: string; to: string; branch?: WorkflowInspectBranch };

/** One complete walk through the definition, from the trigger to an end node. */
export type WorkflowInspectPath = {
  id: string;
  /** The branch taken at each timed event wait, in order. */
  choices: { step: string; branch: WorkflowInspectBranch }[];
  /** Node ids in execution order, starting with the trigger. */
  nodes: string[];
  outcome: WorkflowInspectOutcome;
  /** When the path ends, measured like `offsetMs`. */
  durationMs: number;
};

/** The serializable graph `inspectWorkflow` returns. Safe to `JSON.stringify` as is. */
export type WorkflowInspectGraph = {
  workflow: string;
  version: number;
  cancelOn: string[];
  nodes: WorkflowInspectNode[];
  edges: WorkflowInspectEdge[];
  paths: WorkflowInspectPath[];
  /** True when `maxPaths` or `maxDepth` cut the exploration short. */
  truncated: boolean;
  limits: { maxPaths: number; maxDepth: number };
};

type Choice = WorkflowInspectPath["choices"][number];

type TraceEntry = Exclude<WorkflowInspectNode, { kind: "trigger" | "end" }>;

type Trace = {
  entries: TraceEntry[];
  choices: Choice[];
  /** Indexes into `choices` where the other branch is still unexplored. */
  forks: number[];
  outcome: WorkflowInspectOutcome;
  durationMs: number;
};

const defaultMaxPaths = 32;

const defaultMaxDepth = 100;

const triggerId = "$trigger";

const endId = "$end";

/** The id prefix for one branch choice. Encoding keeps `:` and `/` out of the step name. */
function choicePrefix(choice: Choice) {
  return `${encodeURIComponent(choice.step)}:${choice.branch}/`;
}

class DepthLimit extends Error {}

/** Round-trips a JSON value, as the engine does before `run` sees it. */
function savedForm<T extends WorkflowJsonValue | undefined>(value: T): T {
  // SAFETY: T is a JSON value, so the round trip yields the same value minus `undefined` fields,
  // which the type already allows to be absent.
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T);
}

function formatAddress(address: EmailAddress): string {
  if (isStringMember(address)) return address;

  return address.name ? `${address.name} <${address.email}>` : address.email;
}

function isAddressList(addresses: OneOrMany<EmailAddress>): addresses is readonly EmailAddress[] {
  return Array.isArray(addresses);
}

function formatAddresses(addresses: OneOrMany<EmailAddress> | undefined): string[] {
  if (addresses === undefined) return [];

  return isAddressList(addresses) ? addresses.map(formatAddress) : [formatAddress(addresses)];
}

function renderEmail(message: EmailMessage): WorkflowInspectEmail {
  const email: WorkflowInspectEmail = {
    from: formatAddress(message.from),
    to: formatAddresses(message.to),
    cc: formatAddresses(message.cc),
    bcc: formatAddresses(message.bcc),
    replyTo: formatAddresses(message.replyTo),
    subject: message.subject,
  };

  if (message.text !== undefined) email.text = message.text;

  if (message.html !== undefined) email.html = message.html;

  return email;
}

const durationUnits = [
  ["w", 604_800_000],
  ["d", 86_400_000],
  ["h", 3_600_000],
  ["m", 60_000],
  ["s", 1_000],
] as const;

/** Formats milliseconds as the largest units that divide it, such as `2d`, `1h 30m`, or `500ms`. */
export function formatWorkflowDuration(ms: number): string {
  if (ms === 0) return "0s";

  const parts: string[] = [];
  let rest = Math.round(ms);

  for (const [unit, size] of durationUnits) {
    if (rest >= size) {
      parts.push(`${Math.floor(rest / size)}${unit}`);
      rest %= size;
    }
  }

  if (rest > 0) parts.push(`${rest}ms`);

  return parts.slice(0, 2).join(" ");
}

function stepLabel(result: WorkflowInspectStepResult) {
  return result.status === "mocked" ? `returns ${summarizeJson(result.value)}` : "result unknown";
}

function summarizeJson(value: WorkflowJsonValue | undefined, max = 80): string {
  if (value === undefined) return "nothing";

  const text = JSON.stringify(value);

  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function outcomeLabel(outcome: WorkflowInspectOutcome) {
  switch (outcome.status) {
    case "completed":
      return outcome.output === undefined ? "Completed" : `Completed with ${summarizeJson(outcome.output)}`;
    case "failed":
      return `Failed: ${outcome.error}`;
    case "truncated":
      return `Cut off: ${outcome.reason}`;
    default: {
      const exhaustive: never = outcome;

      return exhaustive;
    }
  }
}

function unsampledHint(events: readonly string[]) {
  if (events.length === 0) return "";

  return ` (note: ${events.map((event) => `"${event}"`).join(", ")} had no sample payload; pass one in events)`;
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause);
}

async function parseInput(definition: AnyWorkflowDefinition, input: WorkflowJsonValue) {
  const stored = savedForm(input);

  if (!definition.input) return stored;

  const validation = await definition.input["~standard"].validate(stored);

  if (validation.issues) {
    throw new WorkflowError(
      "invalid_input",
      `Invalid input for workflow ${definition.name}: ${validation.issues.map((issue) => issue.message).join("; ")}`,
    );
  }

  return savedForm(validation.value);
}

/** Runs the definition once, taking `choices` at the first timed waits and `received` after them. */
async function tracePath(
  definition: AnyWorkflowDefinition,
  input: WorkflowJsonValue,
  options: WorkflowInspectOptions,
  planned: readonly WorkflowInspectBranch[],
  maxDepth: number,
): Promise<Trace> {
  const startedAt = options.startedAt ?? 0;
  const entries: TraceEntry[] = [];
  const choices: Choice[] = [];
  const forks: number[] = [];
  const seen = new Set<string>();
  const unsampled: string[] = [];
  let elapsed = 0;
  let prefix = "";
  let stopped = false;
  // The engine's step-overlap rule: from a `ctx.step` call until its promise settles, every other
  // `ctx` call fails, and the first one fails the path even when the definition catches it.
  let activeStep: string | undefined;
  let violation: WorkflowError | undefined;

  function enter(name: string) {
    if (violation) throw violation;

    if (activeStep !== undefined) {
      violation = stepOverlapError(name, activeStep);

      throw violation;
    }

    if (stopped || entries.length >= maxDepth) {
      stopped = true;

      throw new DepthLimit(`More than ${maxDepth} ctx calls in one path.`);
    }

    const invalidName = stepNameError(name);

    if (invalidName) throw invalidName;

    if (seen.has(name)) {
      throw new WorkflowError("duplicate_step", `Step name "${name}" is used more than once in this run.`);
    }

    seen.add(name);

    return { id: `${prefix}${encodeURIComponent(name)}`, offsetMs: elapsed };
  }

  function received(event: string) {
    const sampled = options.events !== undefined && Object.hasOwn(options.events, event);

    if (!sampled) unsampled.push(event);

    return { status: "received", payload: sampled ? savedForm(options.events?.[event]) : undefined, receivedAt: startedAt + elapsed } as const;
  }

  const ctx: WorkflowContext = {
    runId: "inspect",
    workflow: definition.name,
    version: definition.version,
    subject: options.subject,
    startedAt,
    async send(name, message): Promise<WorkflowSendRecord> {
      const base = enter(name);
      const email = renderEmail(message);

      entries.push({ ...base, kind: "send", step: name, email, label: `${email.subject} → ${email.to.join(", ")}` });

      return { adapter: "inspect", id: `inspect:${name}` };
    },
    // SAFETY: the callback never runs during inspection, so the only value returned is the caller's
    // mock, which states the step's result contract the same way the engine's journal does.
    step: ((name: string) => {
      const pending = (async () => {
        const base = enter(name);
        const mocked = options.steps !== undefined && Object.hasOwn(options.steps, name);
        const value = mocked ? savedForm(options.steps?.[name]) : undefined;

        const result: WorkflowInspectStepResult =
          mocked && value !== undefined ? { status: "mocked", value } : { status: "unknown" };

        entries.push({ ...base, kind: "step", step: name, result, label: stepLabel(result) });

        // The graph keeps its own copy, so a workflow that edits the result can't rewrite the node.
        return savedForm(value);
      })();

      // As in the engine, a rejected call leaves no step running.
      if (stopped || violation) return pending;

      activeStep = name;

      const release = () => {
        if (activeStep === name) activeStep = undefined;
      };

      pending.then(release, release);

      return pending;
    }) as WorkflowContext["step"],
    async sleep(name, duration: WorkflowDuration) {
      const base = enter(name);
      const ms = durationToMs(duration);

      entries.push({ ...base, kind: "sleep", step: name, delay: { kind: "duration", ms }, label: `Wait ${formatWorkflowDuration(ms)}` });
      elapsed += ms;
    },
    async sleepUntil(name, at) {
      const base = enter(name);
      const until = Number(at);

      if (!Number.isFinite(until)) {
        throw new WorkflowError("invalid_duration", `sleepUntil "${name}" needs a valid Date or epoch milliseconds.`);
      }

      const ms = Math.max(0, until - (startedAt + elapsed));
      const iso = new Date(until).toISOString();

      entries.push({ ...base, kind: "sleep", step: name, delay: { kind: "until", at: iso, ms }, label: `Wait until ${iso}` });
      elapsed += ms;
    },
    // SAFETY: the sample payload from `options.events` stands in for a delivered event. Payloads are
    // never parsed, by the engine or here: the caller's type argument states the payload contract.
    waitForEvent: (async (name: string, waitOptions?: { event?: string; timeout?: WorkflowDuration }) => {
      const base = enter(name);
      const event = waitOptions?.event ?? name;
      const timeoutMs = waitOptions?.timeout === undefined ? undefined : durationToMs(waitOptions.timeout);
      const timeoutText = timeoutMs === undefined ? "no timeout" : `timeout ${formatWorkflowDuration(timeoutMs)}`;
      const node: TraceEntry = { ...base, kind: "waitForEvent", step: name, event, label: `Wait for "${event}" (${timeoutText})` };

      if (timeoutMs !== undefined) node.timeoutMs = timeoutMs;

      entries.push(node);

      if (timeoutMs === undefined) {
        return received(event);
      }

      const index = choices.length;
      const branch = planned[index] ?? "received";

      if (planned[index] === undefined) forks.push(index);

      choices.push({ step: name, branch });
      prefix = `${prefix}${choicePrefix({ step: name, branch })}`;

      if (branch === "timeout") {
        elapsed += timeoutMs;

        return { status: "timed_out" };
      }

      return received(event);
    }) as WorkflowContext["waitForEvent"],
  };

  let outcome: WorkflowInspectOutcome;

  try {
    const output = await definition.run(ctx, input);

    if (violation) throw violation;

    outcome = stopped
      ? { status: "truncated", reason: `More than ${maxDepth} ctx calls in one path.` }
      : output === undefined
        ? { status: "completed" }
        : { status: "completed", output: savedForm(output) };
  } catch (cause) {
    outcome =
      stopped || cause instanceof DepthLimit
        ? { status: "truncated", reason: `More than ${maxDepth} ctx calls in one path.` }
        : { status: "failed", error: `${errorMessage(cause)}${unsampledHint(unsampled)}` };
  }

  return { entries, choices, forks, outcome, durationMs: elapsed };
}

/**
 * Explores a workflow definition without sending anything, and returns every path it can take as a
 * graph of nodes and edges. `run` executes against a tracing `ctx`: `send` records the rendered
 * email, `sleep` and `sleepUntil` record the delay, `waitForEvent` with a timeout forks into a
 * `received` path (using the sample payload from `options.events`) and a `timeout` path, and `step`
 * returns the mock from `options.steps` without calling its callback. Exploration is deterministic
 * and capped by `maxPaths` and `maxDepth`; `truncated` reports when a cap was hit.
 *
 * Code between ctx calls still runs, so keep it free of side effects, as replay already requires.
 */
export async function inspectWorkflow(
  definition: AnyWorkflowDefinition,
  options: WorkflowInspectOptions,
): Promise<WorkflowInspectGraph> {
  const maxPaths = Math.max(1, Math.floor(options.maxPaths ?? defaultMaxPaths));
  const maxDepth = Math.max(1, Math.floor(options.maxDepth ?? defaultMaxDepth));
  const input = await parseInput(definition, options.input);

  const trigger: WorkflowInspectNode = {
    id: triggerId,
    kind: "trigger",
    workflow: definition.name,
    version: definition.version,
    input,
    label: `Start ${definition.name} v${definition.version}`,
    offsetMs: 0,
  };

  const nodes = new Map<string, WorkflowInspectNode>([[trigger.id, trigger]]);
  const edges = new Map<string, WorkflowInspectEdge>();
  const paths: WorkflowInspectPath[] = [];
  const pending: WorkflowInspectBranch[][] = [[]];
  let truncated = false;

  for (let planned = pending.shift(); planned !== undefined; planned = pending.shift()) {
    if (paths.length >= maxPaths) {
      truncated = true;
      break;
    }

    // Each path gets its own saved copy, as each engine run does, so a workflow that edits its
    // input can't change later paths or the trigger node.
    const trace = await tracePath(definition, savedForm(input), options, planned, maxDepth);

    const end: WorkflowInspectNode = {
      id: `${trace.choices.map(choicePrefix).join("")}${endId}`,
      kind: "end",
      outcome: trace.outcome,
      label: outcomeLabel(trace.outcome),
      offsetMs: trace.durationMs,
    };

    for (const index of trace.forks) {
      pending.push([...trace.choices.slice(0, index).map((choice) => choice.branch), "timeout"]);
    }

    if (trace.outcome.status === "truncated") truncated = true;

    const walk: WorkflowInspectNode[] = [trigger, ...trace.entries, end];

    for (const node of walk) {
      if (!nodes.has(node.id)) nodes.set(node.id, node);
    }

    for (let index = 1; index < walk.length; index += 1) {
      const from = walk[index - 1];
      const to = walk[index];

      if (from === undefined || to === undefined) continue;

      const choice = from.kind === "waitForEvent" ? trace.choices.find((item) => item.step === from.step) : undefined;
      const key = `${from.id}->${to.id}`;

      if (!edges.has(key)) edges.set(key, choice ? { from: from.id, to: to.id, branch: choice.branch } : { from: from.id, to: to.id });
    }

    paths.push({
      id: `path-${paths.length + 1}`,
      choices: trace.choices,
      nodes: walk.map((node) => node.id),
      outcome: trace.outcome,
      durationMs: trace.durationMs,
    });
  }

  return {
    workflow: definition.name,
    version: definition.version,
    cancelOn: [...definition.cancelOn],
    nodes: [...nodes.values()],
    edges: [...edges.values()],
    paths,
    truncated,
    limits: { maxPaths, maxDepth },
  };
}

/** The visible escape for one character of user text, or the character itself when it is printable. */
function escapeChar(char: string) {
  switch (char) {
    case "\\":
      return "\\\\";
    case "\n":
      return "\\n";
    case "\r":
      return "\\r";
    case "\t":
      return "\\t";
    default: {
      const code = char.codePointAt(0) ?? 0;
      const control = code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029;

      return control ? `\\u${code.toString(16).padStart(4, "0")}` : char;
    }
  }
}

/**
 * Keeps user text on one line: line breaks, tabs, and other control characters become visible
 * escapes such as `\n` and `\u001b`, and backslashes double so an escape can't be faked. Nothing
 * else changes, so the separators the formatters add stay unambiguous.
 */
function oneLine(text: string) {
  return Array.from(text, escapeChar).join("");
}

function mermaidText(text: string) {
  return oneLine(text)
    .replaceAll("&", "#amp;")
    .replaceAll('"', "#quot;")
    .replaceAll("<", "#lt;")
    .replaceAll(">", "#gt;");
}

function mermaidNode(id: string, node: WorkflowInspectNode) {
  const text = node.kind === "trigger" || node.kind === "end" ? [node.label] : [`${node.kind} ${node.step}`, node.label];
  const label = `"${text.map(mermaidText).join("<br/>")}"`;

  switch (node.kind) {
    case "trigger":
      return `${id}([${label}])`;
    case "send":
      return `${id}[${label}]`;
    case "sleep":
      return `${id}{{${label}}}`;
    case "waitForEvent":
      return `${id}{${label}}`;
    case "step":
      return `${id}[[${label}]]`;
    case "end":
      return `${id}((${label}))`;
    default: {
      const exhaustive: never = node;

      return exhaustive;
    }
  }
}

/**
 * Renders an inspected graph as a Mermaid flowchart. Branch edges carry `received` or `timeout`
 * labels, and `cancelOn` events appear as a separate note node.
 */
export function toMermaid(graph: WorkflowInspectGraph): string {
  const ids = new Map(graph.nodes.map((node, index) => [node.id, `n${index}`]));
  const lines = ["flowchart TD"];

  for (const node of graph.nodes) {
    lines.push(`  ${mermaidNode(ids.get(node.id) ?? node.id, node)}`);
  }

  for (const edge of graph.edges) {
    const arrow = edge.branch ? `-->|${edge.branch}|` : "-->";

    lines.push(`  ${ids.get(edge.from) ?? edge.from} ${arrow} ${ids.get(edge.to) ?? edge.to}`);
  }

  if (graph.cancelOn.length > 0) {
    lines.push(`  cancel>"Cancels on: ${mermaidText(graph.cancelOn.join(", "))}"]`);
  }

  if (graph.truncated) lines.push(`  %% truncated: maxPaths=${graph.limits.maxPaths}, maxDepth=${graph.limits.maxDepth}`);

  return lines.join("\n");
}

/** Renders an inspected graph as plain text: one block per path, one line per node. */
export function formatWorkflowGraph(graph: WorkflowInspectGraph): string {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const cancel = graph.cancelOn.length > 0 ? ` (cancels on: ${graph.cancelOn.map(oneLine).join(", ")})` : "";
  const lines = [`${oneLine(graph.workflow)} v${graph.version}${cancel}`];

  for (const path of graph.paths) {
    const choices = path.choices.map((choice) => `${oneLine(choice.step)} ${choice.branch}`).join(", ");

    lines.push("", `${path.id}${choices ? ` [${choices}]` : ""}: ${path.outcome.status} after ${formatWorkflowDuration(path.durationMs)}`);

    for (const id of path.nodes) {
      const node = byId.get(id);

      if (!node) continue;

      const name = node.kind === "trigger" || node.kind === "end" ? node.kind : `${node.kind} ${oneLine(node.step)}`;

      lines.push(`  +${formatWorkflowDuration(node.offsetMs).padEnd(7)} ${name.padEnd(28)} ${oneLine(node.label)}`);
    }
  }

  if (graph.truncated) {
    lines.push("", `Truncated: exploration hit maxPaths=${graph.limits.maxPaths} or maxDepth=${graph.limits.maxDepth}.`);
  }

  return lines.join("\n");
}

/** One journal entry of a run, or the step it is blocked on, in `describeRun` order. */
export type WorkflowRunTimelineEntry =
  | { status: "completed"; step: string; kind: WorkflowStepKind; completedAt: string; summary: string }
  | {
      status: "retrying";
      step: string;
      kind: "send" | "step";
      attempts: number;
      lastError: string;
      /** When the next attempt is due, while the run waits on it. */
      nextAttemptAt?: string;
    }
  | { status: "waiting"; step: string; kind: "sleep" | "event"; event?: string; until?: string };

/** The current wait of a run, if it is blocked. `until` is the deadline; untimed event waits have none. */
export type WorkflowRunTimelineWait = { kind: "sleep" | "retry" | "event"; step: string; event?: string; until?: string };

/** A readable view of one stored run, from `describeRun`. Times are ISO 8601 strings. */
export type WorkflowRunTimeline = {
  runId: string;
  workflow: string;
  version: number;
  status: WorkflowRunStatus;
  subject?: string;
  createdAt: string;
  updatedAt: string;
  entries: WorkflowRunTimelineEntry[];
  wait?: WorkflowRunTimelineWait;
  output?: WorkflowJsonValue;
  error?: { message: string; step?: string };
  cancelReason?: string;
};

function iso(ms: number) {
  return new Date(ms).toISOString();
}

function field(value: WorkflowJsonValue | undefined, key: string): WorkflowJsonValue | undefined {
  if (!isObjectLike(value) || Array.isArray(value) || !(key in value)) return undefined;

  return Object.getOwnPropertyDescriptor(value, key)?.value;
}

function summarizeRecord(kind: WorkflowStepKind, result: WorkflowJsonValue | undefined) {
  switch (kind) {
    case "send": {
      const adapter = field(result, "adapter");
      const id = field(result, "id");

      return `Sent via ${isString(adapter) ? adapter : "unknown adapter"}${isString(id) ? ` (${id})` : ""}`;
    }

    case "event": {
      if (field(result, "status") !== "received") return "Timed out";

      const payload = field(result, "payload");

      return payload === undefined ? "Received" : `Received ${summarizeJson(payload)}`;
    }

    case "sleep":
      return "Waited";
    case "step":
      return `Returned ${summarizeJson(result)}`;
    default: {
      const exhaustive: never = kind;

      return exhaustive;
    }
  }
}

function timelineEntry(step: string, record: WorkflowStepRecord, run: WorkflowRun): WorkflowRunTimelineEntry {
  if (record.status === "completed") {
    return { status: "completed", step, kind: record.kind, completedAt: iso(record.completedAt), summary: summarizeRecord(record.kind, record.result) };
  }

  const entry: WorkflowRunTimelineEntry = {
    status: "retrying",
    step,
    kind: record.kind,
    attempts: record.attempts,
    lastError: record.lastError,
  };

  if (run.wait?.kind === "retry" && run.wait.step === step) entry.nextAttemptAt = iso(run.wait.until);

  return entry;
}

function describeWait(wait: NonNullable<WorkflowRun["wait"]>): WorkflowRunTimelineWait {
  const described: WorkflowRunTimelineWait = { kind: wait.kind, step: wait.step };

  if (wait.kind === "event") described.event = wait.event;

  if (wait.until !== undefined) described.until = iso(wait.until);

  return described;
}

/**
 * The journal's entries in the order the run reached them. Object key order can't say: number-like
 * step names always enumerate first. With every entry numbered, the engine's `sequence` decides.
 * A journal saved before `sequence` existed falls back to completion time, with a retrying entry
 * last, since steps run one at a time and a retrying step is the one the run is on. Ties keep
 * key order.
 */
function journalInRunOrder(journal: WorkflowRun["journal"]): [string, WorkflowStepRecord][] {
  const entries = Object.entries(journal);

  if (entries.every(([, record]) => record.sequence !== undefined)) {
    return entries.toSorted(([, a], [, b]) => (a.sequence ?? 0) - (b.sequence ?? 0));
  }

  const position = (record: WorkflowStepRecord) => (record.status === "completed" ? record.completedAt : Number.POSITIVE_INFINITY);

  return entries.toSorted(([, a], [, b]) => {
    const difference = position(a) - position(b);

    return Number.isNaN(difference) ? 0 : difference;
  });
}

/**
 * Turns a stored `WorkflowRun` into a timeline: every journaled step in the order it ran, with its
 * kind, status, completion time, and a short result summary, followed by the step the run is
 * blocked on. Also reports the current wait and its deadline, the output, error, and cancel reason.
 */
export function describeRun(run: WorkflowRun): WorkflowRunTimeline {
  const entries = journalInRunOrder(run.journal).map(([step, record]) => timelineEntry(step, record, run));
  const wait = run.wait;

  if ((wait?.kind === "sleep" || wait?.kind === "event") && !Object.hasOwn(run.journal, wait.step)) {
    const waiting: WorkflowRunTimelineEntry = { status: "waiting", step: wait.step, kind: wait.kind };

    if (wait.kind === "event") waiting.event = wait.event;

    if (wait.until !== undefined) waiting.until = iso(wait.until);

    entries.push(waiting);
  }

  const timeline: WorkflowRunTimeline = {
    runId: run.id,
    workflow: run.workflow,
    version: run.version,
    status: run.status,
    createdAt: iso(run.createdAt),
    updatedAt: iso(run.updatedAt),
    entries,
  };

  if (run.subject !== undefined) timeline.subject = run.subject;

  if (wait) timeline.wait = describeWait(wait);

  if (run.output !== undefined) timeline.output = run.output;

  if (run.error) timeline.error = run.error;

  if (run.cancelReason !== undefined) timeline.cancelReason = run.cancelReason;

  return timeline;
}
