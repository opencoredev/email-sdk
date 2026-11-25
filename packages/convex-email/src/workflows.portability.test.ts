import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";

// `@opencoredev/convex-email/workflows` runs inside Convex queries, mutations, and default-runtime
// actions, which have no Node built-ins. The email-sdk workflows entry it imports has its own guard.
// It also imports only types from `@opencoredev/email-sdk/workflows`, so the package keeps working
// with email-sdk 3.0.x, whose peer range it still accepts.

const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

const builtins = new Set(builtinModules);

function importsOf(source: string): string[] {
  return Array.from(source.matchAll(specifier), (match) => match[1] ?? "");
}

function isBuiltin(name: string) {
  return name.startsWith("node:") || builtins.has(name.split("/")[0] ?? name);
}

const sdkWorkflows = "@opencoredev/email-sdk/workflows";

// A whole import or export statement, up to its module specifier. `type` right after the keyword
// marks a statement TypeScript always erases; `import { type X }` can survive compilation.
const statement = /(?:^|[;\n])\s*(import|export)\s+(type\s+)?(?:[^;"']*?\bfrom\s*)?["']([^"']+)["']/g;

const dynamicLoad = /\b(?:import|require)\s*\(\s*["']([^"']+)["']/g;

/** Module specifiers that `source` loads at runtime: every statement not marked `type`, and every dynamic load. */
function runtimeImportsOf(source: string): string[] {
  const statements = Array.from(source.matchAll(statement), (match) => (match[2] ? undefined : match[3]));
  const dynamic = Array.from(source.matchAll(dynamicLoad), (match) => match[1]);

  return [...statements, ...dynamic].filter((name) => name !== undefined);
}

function loadsSdkWorkflows(source: string): boolean {
  return runtimeImportsOf(source).some((name) => name === sdkWorkflows || name.startsWith(`${sdkWorkflows}/`));
}

/** Every source file reachable from `entry` through relative imports. */
function sourceGraph(entry: string): string[] {
  const seen = new Set<string>();
  const pending = [entry];

  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (seen.has(file)) continue;

    seen.add(file);

    for (const name of importsOf(readFileSync(file, "utf8"))) {
      if (name.startsWith(".")) pending.push(resolve(dirname(file), name.replace(/\.js$/, ".ts")));
    }
  }

  return [...seen];
}

describe("workflows: runtime portability", () => {
  test("no file reachable from the workflows client imports a Node built-in", () => {
    const files = sourceGraph(resolve(import.meta.dir, "client/workflows.ts"));

    const offenders = files.flatMap((file) =>
      importsOf(readFileSync(file, "utf8"))
        .filter(isBuiltin)
        .map((name) => `${file}: ${name}`),
    );

    expect(files.some((file) => file.endsWith("shared/types.ts"))).toBe(true);
    expect(offenders).toEqual([]);
  });

  test("no file reachable from the workflows client loads @opencoredev/email-sdk/workflows at runtime", () => {
    const files = sourceGraph(resolve(import.meta.dir, "client/workflows.ts"));
    const offenders = files.filter((file) => loadsSdkWorkflows(readFileSync(file, "utf8")));

    // Bun erases type-only imports the way tsc does, so this checks what the compiled file loads.
    const transpiled = new Bun.Transpiler({ loader: "ts" }).scanImports(
      readFileSync(resolve(import.meta.dir, "client/workflows.ts"), "utf8"),
    );

    expect(offenders).toEqual([]);
    expect(transpiled.map((entry) => entry.path)).not.toContain(sdkWorkflows);
  });

  test("the email-sdk workflows guard tells runtime imports from type-only ones", () => {
    const runtime = [
      'import { WorkflowError } from "@opencoredev/email-sdk/workflows";',
      'import { type WorkflowRun, WorkflowError } from "@opencoredev/email-sdk/workflows";',
      'import {\n  type WorkflowRun,\n} from "@opencoredev/email-sdk/workflows";',
      'import * as workflows from "@opencoredev/email-sdk/workflows";',
      'export { WorkflowError } from "@opencoredev/email-sdk/workflows";',
      'import "@opencoredev/email-sdk/workflows";',
      'const workflows = await import("@opencoredev/email-sdk/workflows");',
      'const workflows = require("@opencoredev/email-sdk/workflows");',
    ];

    const typeOnly = [
      'import type { WorkflowRun } from "@opencoredev/email-sdk/workflows";',
      'import type {\n  WorkflowRun,\n  WorkflowStore,\n} from "@opencoredev/email-sdk/workflows";',
      'export type { WorkflowRun } from "@opencoredev/email-sdk/workflows";',
      'import { WorkflowError } from "@opencoredev/email-sdk";',
    ];

    expect(runtime.filter((source) => !loadsSdkWorkflows(source))).toEqual([]);
    expect(typeOnly.filter(loadsSdkWorkflows)).toEqual([]);
  });

  test("the guard catches every import form", () => {
    const forms = [
      'import { AsyncLocalStorage } from "node:async_hooks";',
      "export { x } from 'node:fs';",
      'const fs = require("node:fs");',
      'const fs = await import("fs/promises");',
      'import "node:process";',
    ];

    expect(forms.map((form) => importsOf(form).filter(isBuiltin))).toEqual([
      ["node:async_hooks"],
      ["node:fs"],
      ["node:fs"],
      ["fs/promises"],
      ["node:process"],
    ]);
  });
});
