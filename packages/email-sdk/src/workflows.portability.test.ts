import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, resolve } from "node:path";

// The workflows entry promises to run anywhere `fetch` does: Convex's default V8 runtime, browsers,
// and Workers without `nodejs_compat`. A Node built-in anywhere in its import graph breaks that.

const specifier = /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|^\s*import\s+)["']([^"']+)["']/gm;

const builtins = new Set(builtinModules);

function importsOf(source: string): string[] {
  return Array.from(source.matchAll(specifier), (match) => match[1] ?? "");
}

function isBuiltin(name: string) {
  return name.startsWith("node:") || builtins.has(name.split("/")[0] ?? name);
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
  test("no file reachable from the workflows entry imports a Node built-in", () => {
    const files = sourceGraph(resolve(import.meta.dir, "workflows.ts"));

    const offenders = files.flatMap((file) =>
      importsOf(readFileSync(file, "utf8"))
        .filter(isBuiltin)
        .map((name) => `${file}: ${name}`),
    );

    expect(files.some((file) => file.endsWith("workflows/engine.ts"))).toBe(true);
    expect(offenders).toEqual([]);
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
