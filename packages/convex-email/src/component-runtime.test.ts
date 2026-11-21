import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, relative } from "node:path";

const componentDir = join(import.meta.dir, "component");

/** Email SDK entry points that only use Web APIs and are safe in Convex's default runtime. */
const runtimeSafeSdkImports = new Set(["@opencoredev/email-sdk/webhooks"]);

const nodeBuiltins = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));

function componentSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) return componentSources(path);

    return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

function importSpecifiers(source: string): string[] {
  return [...source.matchAll(/^\s*(?:import|export)\b[^"']*?from\s+["']([^"']+)["']/gm)].map(
    (match) => match[1] ?? "",
  );
}

// Convex refuses to deploy a component that contains a "use node" module, in the CLI and again in
// the backend. convex-test does not apply that rule, so this guard and `bun run
// convex:deploy-check` are what keep Node-only code out of the component.
describe("component runtime", () => {
  const files = componentSources(componentDir);

  test("finds the component modules", () => {
    expect(files.map((file) => relative(componentDir, file))).toContain("lib.ts");
  });

  for (const file of files) {
    const name = relative(componentDir, file);
    const source = readFileSync(file, "utf8");

    test(`${name} runs in Convex's default runtime`, () => {
      expect(source.trimStart().startsWith('"use node"')).toBe(false);
      expect(importSpecifiers(source).filter((specifier) => nodeBuiltins.has(specifier))).toEqual([]);
      expect(
        importSpecifiers(source).filter(
          (specifier) =>
            specifier.startsWith("@opencoredev/email-sdk") && !runtimeSafeSdkImports.has(specifier),
        ),
      ).toEqual([]);
    });
  }
});
