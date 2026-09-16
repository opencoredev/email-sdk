import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const packageDir = resolve(fileURLToPath(new URL("..", import.meta.url)), "packages/email-sdk");
const packageJson = JSON.parse(await readFile(resolve(packageDir, "package.json"), "utf8"));

const entrypoints = Object.values(packageJson.exports)
  .map((entry) => entry.import)
  .filter(Boolean)
  .map((target) => target.replace(/^\.\/dist\//, "").replace(/\.js$/, ""));

for (const entrypoint of new Set(entrypoints)) {
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
  });

  if (!result.success) {
    throw new AggregateError(result.logs, `Failed to build CommonJS entrypoint ${entrypoint}`);
  }
}
