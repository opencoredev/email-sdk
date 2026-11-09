import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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
const sharedErrors = {
  name: "shared-errors",
  setup(build) {
    build.onResolve({ filter: /(^|\/)errors\.js$/ }, (args) => {
      const target = resolve(dirname(args.importer), args.path).replace(/\.js$/, ".ts");

      return target === errorsSource ? { path: "./errors.cjs", external: true } : undefined;
    });
  },
};

for (const entrypoint of new Set(["errors", ...entrypoints])) {
  const source = resolve(packageDir, "src", `${entrypoint}.ts`);
  const sourceWithTsx = resolve(packageDir, "src", `${entrypoint}.tsx`);
  const resolvedSource = await Bun.file(source).exists() ? source : sourceWithTsx;

  if (!(await Bun.file(resolvedSource).exists())) {
    throw new Error(`Cannot find CommonJS entrypoint source for ${entrypoint}: ${resolvedSource}`);
  }

  const result = await Bun.build({
    entrypoints: [resolvedSource],
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
}
