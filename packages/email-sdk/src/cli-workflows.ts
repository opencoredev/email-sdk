import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { isFunction, isNumber, isObjectLike, isString } from "./internal/decode.js";
import type { JsonObject } from "./internal/decode.js";
import { formatWorkflowGraph, inspectWorkflow, toMermaid } from "./workflows/inspect.js";
import type { AnyWorkflowDefinition, WorkflowJsonValue } from "./workflows/types.js";

/** Output formats for `email-sdk workflows inspect`. */
export const workflowInspectFormats = ["json", "mermaid", "text"] as const;

export type WorkflowInspectFormat = (typeof workflowInspectFormats)[number];

/** Parsed arguments for `email-sdk workflows inspect`. */
export type WorkflowInspectCommand = {
  modulePath: string;
  exportName?: string;
  input: WorkflowJsonValue;
  events?: JsonObject;
  steps?: JsonObject;
  subject?: string;
  maxPaths?: number;
  maxDepth?: number;
  format: WorkflowInspectFormat;
};

/** Thrown for a module or export that can't be inspected; the CLI prints the message and exits 1. */
export class WorkflowCliError extends Error {}

/** True for a value `defineWorkflow` returned: a name, version, cancelOn list, and run function. */
export function isWorkflowDefinition(value: unknown): value is AnyWorkflowDefinition {
  return (
    isObjectLike(value) &&
    "name" in value &&
    isString(value.name) &&
    "version" in value &&
    isNumber(value.version) &&
    "cancelOn" in value &&
    Array.isArray(value.cancelOn) &&
    "run" in value &&
    isFunction(value.run)
  );
}

/**
 * Imports `modulePath` and returns the workflow it exports as `exportName`. Without a name, uses
 * the default export, or the only exported workflow definition when there is exactly one.
 */
export async function loadWorkflowDefinition(modulePath: string, exportName?: string): Promise<AnyWorkflowDefinition> {
  const url = pathToFileURL(resolve(modulePath)).href;
  let namespace: unknown;

  try {
    namespace = await import(url);
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause);

    throw new WorkflowCliError(`Could not import ${modulePath}: ${reason}`);
  }

  if (!isObjectLike(namespace)) throw new WorkflowCliError(`${modulePath} did not load as a module.`);

  const definitions = new Map<string, AnyWorkflowDefinition>();

  for (const [name, value] of Object.entries(namespace)) {
    if (isWorkflowDefinition(value)) definitions.set(name, value);
  }

  const names = [...definitions.keys()].filter((name) => name !== "default");
  const chosen = definitions.get(exportName ?? "default") ?? (exportName === undefined && names.length === 1 ? definitions.get(names[0] ?? "") : undefined);

  if (chosen) return chosen;

  if (exportName !== undefined) {
    throw new WorkflowCliError(`${modulePath} has no workflow export "${exportName}". Workflow exports: ${names.join(", ") || "none"}.`);
  }

  throw new WorkflowCliError(
    names.length === 0
      ? `${modulePath} exports no workflow definitions.`
      : `${modulePath} exports several workflows (${names.join(", ")}). Pick one with --export.`,
  );
}

/** Runs `inspectWorkflow` for the command and returns the output to print. */
export async function runWorkflowInspect(command: WorkflowInspectCommand): Promise<string> {
  const definition = await loadWorkflowDefinition(command.modulePath, command.exportName);

  const graph = await inspectWorkflow(definition, {
    input: command.input,
    events: command.events,
    steps: command.steps,
    subject: command.subject,
    maxPaths: command.maxPaths,
    maxDepth: command.maxDepth,
  });

  switch (command.format) {
    case "json":
      return JSON.stringify(graph, null, 2);
    case "mermaid":
      return toMermaid(graph);
    case "text":
      return formatWorkflowGraph(graph);
    default: {
      const exhaustive: never = command.format;

      return exhaustive;
    }
  }
}
