import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

type PackReport = {
  filename: string;
  files: Array<{ path: string; mode: number }>;
};

const root = resolve(import.meta.dir, "..");
const scratchBase = process.env.JCODE_SCRATCH_DIR ?? tmpdir();
await mkdir(scratchBase, { recursive: true });
const scratch = await mkdtemp(join(scratchBase, "email-sdk-pack-check-"));

try {
  const packed = join(scratch, "packed");
  await mkdir(packed);

  console.log("Packing public packages and Convex component...");
  const core = await pack(join(root, "packages/email-sdk"), packed);
  await pack(join(root, "packages/convex-email"), packed);

  assertCoreTarball(core);

  const coreTarball = join(packed, core.filename);
  const install = join(scratch, "install");
  await mkdir(install);
  await writeFile(
    join(install, "package.json"),
    `${JSON.stringify({ private: true, type: "module" }, null, 2)}\n`,
  );

  console.log("Installing packed public packages in a clean project...");
  await run(
    [
      "npm",
      "install",
      "--ignore-scripts",
      "--no-audit",
      "--no-fund",
      coreTarball,
      "ai@^7.0.0",
      "@react-email/render@^2.1.0",
      "react@^19.0.0",
      "react-dom@^19.0.0",
    ],
    install,
  );

  const smoke = join(install, "smoke.mjs");
  await writeFile(smoke, smokeProgram());

  console.log("Running installed-package smoke tests under Node...");
  await run(["node", smoke], install);
  console.log("Running installed-package smoke tests under Bun...");
  await run(["bun", smoke], install);
  console.log("Installed package smoke tests passed.");
} finally {
  await rm(scratch, { recursive: true, force: true });
}

async function pack(packageDir: string, destination: string): Promise<PackReport> {
  const output = await run(
    ["npm", "pack", "--json", "--silent", "--pack-destination", destination],
    packageDir,
  );
  const jsonStart = output.lastIndexOf("\n[");
  const report = JSON.parse(output.slice(jsonStart >= 0 ? jsonStart + 1 : output.indexOf("["))) as
    | PackReport[]
    | undefined;

  if (!report || report.length !== 1) {
    throw new Error(`npm pack did not return one package for ${basename(packageDir)}.`);
  }

  return report[0];
}

function assertCoreTarball(report: PackReport) {
  const paths = new Set(report.files.map((file) => file.path));

  for (const required of [
    "README.md",
    "package.json",
    "dist/cli.js",
    "dist/react.d.ts",
    "dist/react.js",
    "dist/react-shadcn.d.ts",
    "dist/react-shadcn.js",
    "src/index.ts",
    "src/react.ts",
    "src/react-shadcn.tsx",
  ]) {
    if (!paths.has(required)) {
      throw new Error(`Email SDK tarball is missing ${required}.`);
    }
  }

  if ([...paths].some((path) => path.endsWith(".test.ts") || path.startsWith("type-tests/"))) {
    throw new Error("Email SDK tarball contains test-only source files.");
  }

  if (report.files.find((file) => file.path === "dist/cli.js")?.mode !== 0o755) {
    throw new Error("Email SDK CLI is not executable in the tarball.");
  }
}

async function run(command: string[], cwd: string): Promise<string> {
  const child = Bun.spawn(command, {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} failed in ${cwd}.\n${stdout}${stderr}`.trimEnd(),
    );
  }

  return stdout;
}

function smokeProgram(): string {
  return String.raw`
import { access, readFile, readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = dirname(fileURLToPath(import.meta.url));
const coreDir = join(root, "node_modules/@opencoredev/email-sdk");

await importAllExports(coreDir, "@opencoredev/email-sdk");

const core = await import("@opencoredev/email-sdk");
const resend = await import("@opencoredev/email-sdk/resend");
const react = await import("@opencoredev/email-sdk/react");

if (
  typeof core.createEmailClient !== "function" ||
  typeof resend.resend !== "function" ||
  typeof react.renderEmail !== "function" ||
  typeof react.ShadcnEmail !== "function" ||
  typeof react.EmailButton !== "function"
) {
  throw new Error("Installed Email SDK exports are incomplete.");
}

await verifyDeclarationMaps(coreDir);

const coreCli = join(coreDir, "dist/cli.js");
const coreManifest = JSON.parse(await readFile(join(coreDir, "package.json"), "utf8"));
const coreVersion = spawnSync(process.execPath, [coreCli, "version"], {
  encoding: "utf8",
  env: { ...process.env, EMAIL_SDK_TELEMETRY: "0" },
});
if (
  coreVersion.status !== 0 ||
  !coreVersion.stdout.includes("@opencoredev/email-sdk") ||
  !coreVersion.stdout.includes(coreManifest.version)
) {
  throw new Error("Installed Email SDK CLI smoke test failed.");
}

async function verifyDeclarationMaps(packageDir) {
  for (const mapPath of await declarationMaps(join(packageDir, "dist"))) {
    const map = JSON.parse(await readFile(mapPath, "utf8"));
    for (const source of map.sources ?? []) {
      await access(resolve(dirname(mapPath), source));
    }
  }
}

async function importAllExports(packageDir, packageName) {
  const manifest = JSON.parse(await readFile(join(packageDir, "package.json"), "utf8"));
  for (const subpath of Object.keys(manifest.exports ?? {})) {
    await import(subpath === "." ? packageName : packageName + subpath.slice(1));
  }
}

async function declarationMaps(directory) {
  const paths = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await declarationMaps(path)));
    else if (!entry.name.startsWith("._") && entry.name.endsWith(".d.ts.map")) paths.push(path);
  }
  return paths;
}
`;
}
