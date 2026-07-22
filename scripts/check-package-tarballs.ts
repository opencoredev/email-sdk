import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  const mcp = await pack(join(root, "packages/email-sdk-mcp"), packed);
  await pack(join(root, "packages/convex-email"), packed);

  assertCoreTarball(core);
  assertMcpTarball(mcp);

  const coreTarball = join(packed, core.filename);
  const mcpTarball = join(packed, mcp.filename);
  const coreV1Tarball = await rewriteCoreVersion(coreTarball, scratch);
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
      coreV1Tarball,
      mcpTarball,
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

function assertMcpTarball(report: PackReport) {
  const paths = new Set(report.files.map((file) => file.path));

  for (const required of [
    "README.md",
    "package.json",
    "dist/cli.js",
    "dist/index.d.ts",
    "dist/index.js",
    "dist/stdio.js",
    "src/runtime.ts",
  ]) {
    if (!paths.has(required)) {
      throw new Error(`MCP tarball is missing ${required}.`);
    }
  }

  if ([...paths].some((path) => path.startsWith("test/") || path === "turbo.json")) {
    throw new Error("MCP tarball contains development-only files.");
  }

  if (report.files.find((file) => file.path === "dist/cli.js")?.mode !== 0o755) {
    throw new Error("MCP CLI is not executable in the tarball.");
  }
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

async function rewriteCoreVersion(tarball: string, scratch: string): Promise<string> {
  // The source workspace intentionally remains at 0.6.5 until Changesets applies the
  // pending major. Rewriting only the scratch tarball lets the MCP's final ^1.0.0
  // dependency be installed and tested before release versioning mutates the repo.
  const extracted = join(scratch, "core-v1");
  await mkdir(extracted);
  await run(["tar", "-xzf", tarball, "-C", extracted], root);

  const manifestPath = join(extracted, "package/package.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { version: string };
  manifest.version = "1.0.0";
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const rewritten = join(scratch, "opencoredev-email-sdk-1.0.0.tgz");
  await run(
    ["env", "COPYFILE_DISABLE=1", "tar", "-czf", rewritten, "-C", extracted, "package"],
    root,
  );
  return rewritten;
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

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = dirname(fileURLToPath(import.meta.url));
const coreDir = join(root, "node_modules/@opencoredev/email-sdk");
const mcpDir = join(root, "node_modules/@opencoredev/email-sdk-mcp");
const secret = "CANARY_PACKAGE_SECRET";

await importAllExports(coreDir, "@opencoredev/email-sdk");
await importAllExports(mcpDir, "@opencoredev/email-sdk-mcp");

const core = await import("@opencoredev/email-sdk");
const resend = await import("@opencoredev/email-sdk/resend");
const react = await import("@opencoredev/email-sdk/react");
const mcp = await import("@opencoredev/email-sdk-mcp");
const stdio = await import("@opencoredev/email-sdk-mcp/stdio");

if (
  typeof core.createEmailClient !== "function" ||
  typeof resend.resend !== "function" ||
  typeof react.renderEmail !== "function" ||
  typeof react.ShadcnEmail !== "function" ||
  typeof react.EmailButton !== "function"
) {
  throw new Error("Installed Email SDK exports are incomplete.");
}
if (typeof mcp.createEmailMcpServer !== "function" || typeof stdio.runEmailMcpStdio !== "function") {
  throw new Error("Installed MCP exports are incomplete.");
}

await verifyDeclarationMaps(coreDir);
await verifyDeclarationMaps(mcpDir);

const coreCli = join(coreDir, "dist/cli.js");
const coreVersion = spawnSync(process.execPath, [coreCli, "version"], {
  encoding: "utf8",
  env: { ...process.env, EMAIL_SDK_TELEMETRY: "0" },
});
if (
  coreVersion.status !== 0 ||
  !coreVersion.stdout.includes("@opencoredev/email-sdk") ||
  !coreVersion.stdout.includes("1.0.0")
) {
  throw new Error("Installed Email SDK CLI smoke test failed.");
}

const mcpCli = join(mcpDir, "dist/cli.js");
const rejected = spawnSync(process.execPath, [mcpCli, "--api-key=" + secret], {
  encoding: "utf8",
  env: process.env,
});
if (
  rejected.status === 0 ||
  rejected.stdout !== "" ||
  rejected.stderr.includes(secret) ||
  !rejected.stderr.includes("does not accept command-line flags")
) {
  throw new Error("Installed MCP CLI did not reject secret-bearing flags safely.");
}

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [mcpCli],
  cwd: root,
  stderr: "pipe",
  env: {
    PATH: process.env.PATH ?? "",
    EMAIL_SDK_MCP_ADAPTER: "resend",
    EMAIL_SDK_MCP_FROM: "Acme <hello@example.com>",
    RESEND_API_KEY: secret,
  },
});
let stderr = "";
transport.stderr?.setEncoding("utf8");
transport.stderr?.on("data", (chunk) => {
  stderr += chunk;
});

const client = new Client({ name: "package-smoke", version: "1.0.0" }, { capabilities: {} });
await client.connect(transport);
try {
  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(["email_configuration_status", "email_validate"])) {
    throw new Error("Unexpected default MCP tools: " + names.join(", ") + ".");
  }

  const validation = await client.callTool({
    name: "email_validate",
    arguments: { to: "ada@example.com", subject: "Package smoke", text: "Safe body" },
  });
  const serialized = JSON.stringify(validation);
  if (!serialized.includes("validationReference") || serialized.includes(secret)) {
    throw new Error("Installed MCP validation response is incomplete or leaked a secret.");
  }
} finally {
  await client.close();
}

if (stderr !== "" || stderr.includes(secret)) {
  throw new Error("Installed MCP wrote unexpected diagnostics or a secret to stderr.");
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
