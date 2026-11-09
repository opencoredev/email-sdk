import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(fileURLToPath(new URL("..", import.meta.url)), "packages/email-sdk");

const packageJson = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));

const entrypoints = Object.values(packageJson.exports)
  .map((entry) => entry.import)
  .filter(Boolean)
  .map((target) => target.replace(/^\.\/dist\//, "").replace(/\.js$/, ""));

const errorsSource = resolve(packageDir, "src", "errors.ts");

// Bun can't split shared code across CommonJS outputs, so each entrypoint would inline its own
// copy of the error classes. Core then fails `instanceof EmailAdapterError` for an error thrown by
// a separately required adapter and loses its delivery classification. Every entrypoint instead
// requires one shared dist/errors.cjs, which keeps error class identity across entrypoints.
//
// Bun 1.3 keeps the original specifier (`../errors.js`) for an external that onResolve redirects,
// while newer Bun writes the returned path. So the plugin records every specifier that pointed at
// src/errors.ts, and rewriteSharedErrors() points those requires at ./errors.cjs after each build.
// All CommonJS outputs sit flat in dist/, so ./errors.cjs is right for every one of them.
const sharedErrorSpecifiers = new Set(["./errors.cjs"]);

const sharedErrors = {
  name: "shared-errors",
  setup(build) {
    build.onResolve({ filter: /(^|\/)errors\.js$/ }, (args) => {
      const target = resolve(dirname(args.importer), args.path).replace(/\.js$/, ".ts");

      if (target !== errorsSource) return undefined;

      sharedErrorSpecifiers.add(args.path);

      return { path: "./errors.cjs", external: true };
    });
  },
};

async function rewriteSharedErrors(outputPath) {
  const code = await readFile(outputPath, "utf8");

  const rewritten = code.replace(/require\((["'])([^"']+)\1\)/g, (call, _quote, specifier) =>
    sharedErrorSpecifiers.has(specifier) ? 'require("./errors.cjs")' : call,
  );

  if (rewritten !== code) await writeFile(outputPath, rewritten);
}

// Bun 1.3 drops the module bodies when a CommonJS entry only re-exports (src/index.ts), so the
// built index.cjs threw "import_core is not defined" on first property access. Building each
// entry through a one-line `export * from` wrapper produces complete output. No entry has a
// default export, which `export *` would drop.
const wrapperDir = await mkdtemp(join(tmpdir(), "email-sdk-cjs-"));

try {
  for (const entrypoint of new Set(["errors", ...entrypoints])) {
    await buildEntrypoint(entrypoint);
  }
} finally {
  await rm(wrapperDir, { recursive: true, force: true });
}

async function buildEntrypoint(entrypoint) {
  const source = resolve(packageDir, "src", `${entrypoint}.ts`);
  const sourceWithTsx = resolve(packageDir, "src", `${entrypoint}.tsx`);
  const resolvedSource = await Bun.file(source).exists() ? source : sourceWithTsx;

  if (!(await Bun.file(resolvedSource).exists())) {
    throw new Error(`Cannot find CommonJS entrypoint source for ${entrypoint}: ${resolvedSource}`);
  }

  const wrapper = join(wrapperDir, `${entrypoint}.ts`);
  await writeFile(wrapper, `export * from ${JSON.stringify(resolvedSource)};\n`);

  const result = await Bun.build({
    entrypoints: [wrapper],
    outdir: resolve(packageDir, "dist"),
    naming: `${entrypoint}.cjs`,
    format: "cjs",
    target: "node",
    write: true,
    external: ["ai", "react", "react-dom", "@react-email/render"],
    plugins: [sharedErrors],
  });

  if (!result.success) {
    throw new AggregateError(result.logs, `Failed to build CommonJS entrypoint ${entrypoint}`);
  }

  for (const output of result.outputs) await rewriteSharedErrors(output.path);
}
