// Minifies the tsc output in dist/ in place to shrink the published package
// and the bytes the CLI parses at startup. Each module is processed with all
// imports external so the module graph (and the CLI's lazy loading) is
// preserved. Identifiers are kept so published stack traces stay readable.
//
// Bun's bundler can mangle some external re-export shapes (e.g. pure barrel
// files), so every minified module is link-checked in Node afterwards; any
// module that no longer links is restored to its original tsc output.
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const distDir = new URL("../dist", import.meta.url).pathname;
const files = readdirSync(distDir).filter((file) => file.endsWith(".js"));
const originals = new Map<string, string>();

let before = 0;
let after = 0;

for (const file of files) {
  const path = join(distDir, file);
  const source = await Bun.file(path).text();
  originals.set(file, source);

  const result = await Bun.build({
    entrypoints: [path],
    external: ["*"],
    target: "node",
    minify: { whitespace: true, syntax: true, identifiers: false },
  });

  if (!result.success) {
    console.error(`Failed to minify ${file}:`);
    for (const log of result.logs) {
      console.error(log);
    }
    process.exit(1);
  }

  const output = result.outputs[0];

  if (!output) {
    console.error(`Minifying ${file} produced no output.`);
    process.exit(1);
  }

  const minified = await output.text();
  before += source.length;
  after += minified.length;
  await Bun.write(path, minified);
}

const broken = await brokenModules();

for (const file of broken) {
  const original = originals.get(file);

  if (!original) {
    console.error(`No original source recorded for broken module ${file}.`);
    process.exit(1);
  }

  await Bun.write(join(distDir, file), original);
  console.warn(`Kept ${file} unminified: the minified output failed to link.`);
}

if (broken.length > 0) {
  const stillBroken = await brokenModules();

  if (stillBroken.length > 0) {
    console.error(`dist modules fail to link even unminified: ${stillBroken.join(", ")}`);
    process.exit(1);
  }
}

console.log(`Minified ${files.length} dist modules: ${before} -> ${after} bytes`);

// Imports every dist module in a real Node process and returns the files that
// fail to load. Importing dist/cli.js with no args just prints help, so a
// throwaway stdout is fine; the verdict travels through a result file.
async function brokenModules(): Promise<string[]> {
  const resultDir = mkdtempSync(join(tmpdir(), "email-sdk-linkcheck-"));
  const resultPath = join(resultDir, "result.json");
  const checker = `
    import { writeFileSync } from "node:fs";
    const { files, distUrl, resultPath } = JSON.parse(process.env.LINK_CHECK ?? "{}");
    const failed = [];
    for (const file of files) {
      try {
        await import(new URL(file, distUrl));
      } catch (error) {
        failed.push([file, String(error?.message ?? error)]);
      }
    }
    writeFileSync(resultPath, JSON.stringify(failed));
  `;

  try {
    const proc = Bun.spawn({
      cmd: ["node", "--input-type=module", "-e", checker],
      env: {
        ...process.env,
        LINK_CHECK: JSON.stringify({
          files,
          distUrl: `${pathToFileURL(distDir).href}/`,
          resultPath,
        }),
      },
      stdout: "ignore",
      stderr: "pipe",
    });
    const [exitCode, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stderr).text(),
    ]);

    if (exitCode !== 0) {
      console.error(`dist link check crashed:\n${stderr}`);
      process.exit(1);
    }

    const failed = (await Bun.file(resultPath).json()) as [string, string][];

    for (const [file, message] of failed) {
      console.warn(`link check: ${file} failed to load: ${message}`);
    }

    return failed.map(([file]) => file);
  } finally {
    rmSync(resultDir, { recursive: true, force: true });
  }
}
