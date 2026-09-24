import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

const requireMode = process.argv.includes("--require");

const run = promisify(execFile);

const root = resolve(new URL("..", import.meta.url).pathname);

const packageDir = resolve(root, "packages/email-sdk");

const packageJson = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));

// Exercise the package through its published exports map, rather than loading
// repository-relative dist files. This catches packaging and conditional-export
// regressions in the same way a consumer encounters them.
const scratch = await mkdtemp(join(tmpdir(), "email-sdk-node-compatibility-"));

try {
  const tarballDir = join(scratch, "tarball");
  await mkdir(tarballDir);
  await run("npm", ["pack", "--ignore-scripts", "--silent", "--pack-destination", tarballDir], {
    cwd: packageDir,
  });
  await run("npm", ["init", "--yes", "--silent"], { cwd: scratch });
  const tarball = join(tarballDir, (await readdir(tarballDir)).find((file) => file.endsWith(".tgz")));
  await run(
    "npm",
    ["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball, "ai@7", "react@19", "react-dom@19", "@react-email/render@2"],
    { cwd: scratch },
  );
  await writeFile(join(scratch, "probe.mjs"), 'const sdk = await import("@opencoredev/email-sdk");\nif (typeof sdk.createEmailClient !== "function") throw new Error("ESM root export missing");\n');
  await run("node", ["probe.mjs"], { cwd: scratch });

  if (requireMode) {
    const subpaths = Object.entries(packageJson.exports).map(([subpath, entry]) => {
      assert.ok(entry.require, `${subpath} is missing a CommonJS export`);

      return subpath === "." ? packageJson.name : `${packageJson.name}${subpath.slice(1)}`;
    });

    await writeFile(
      join(scratch, "probe.cjs"),
      `for (const specifier of ${JSON.stringify(subpaths)}) { const loaded = require(specifier); if (!loaded || typeof loaded !== "object") throw new Error(specifier + " did not load as CommonJS"); }\n`,
    );
    await run("node", ["probe.cjs"], { cwd: scratch });
  }
} finally {
  await rm(scratch, { recursive: true, force: true });
}

console.log(`Node ${process.version}: ESM${requireMode ? " + CommonJS" : ""} compatibility passed`);
