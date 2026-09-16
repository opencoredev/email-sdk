import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";

const requireMode = process.argv.includes("--require");
const packageDir = resolve(new URL("..", import.meta.url).pathname, "packages/email-sdk");
const packageJson = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));
const esm = await import(resolve(packageDir, "dist/index.js"));
assert.equal(typeof esm.createEmailClient, "function");

if (requireMode) {
  const require = createRequire(import.meta.url);
  for (const [subpath, entry] of Object.entries(packageJson.exports)) {
    const target = entry.require;
    assert.ok(target, `${subpath} is missing a CommonJS export`);
    const loaded = require(resolve(packageDir, target));
    assert.ok(loaded && typeof loaded === "object", `${subpath} did not load as CommonJS`);
  }
}

console.log(`Node ${process.version}: ESM${requireMode ? " + CommonJS" : ""} compatibility passed`);
