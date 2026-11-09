import verification from "../adapter-verification.json";

const liveAdapters = Object.keys(verification.liveChecks).sort();

export function selectLiveAdapters(files: string[]): string[] {
  if (files.some(isSharedAdapterFile)) return liveAdapters;

  return liveAdapters.filter((adapter) =>
    files.some(
      (file) =>
        file === `packages/email-sdk/src/${adapter}.ts` ||
        file === `scripts/check-${adapter}-account.ts`,
    ),
  );
}

// Space-separated checks to never select, for environments that lack their
// credentials. CI sets it in .github/workflows/ci.yml.
function excludedAdapters(value = ""): Set<string> {
  const excluded = new Set(value.split(/\s+/).filter(Boolean));

  for (const adapter of excluded) {
    if (!liveAdapters.includes(adapter)) {
      console.error(`Unknown live adapter in LIVE_ADAPTERS_EXCLUDE: ${adapter}`);
      process.exit(1);
    }
  }

  return excluded;
}

async function main() {
  const [base, head] = process.argv.slice(2);
  const excluded = excludedAdapters(process.env.LIVE_ADAPTERS_EXCLUDE);

  const print = (adapters: string[]) =>
    console.log(adapters.filter((adapter) => !excluded.has(adapter)).join(" "));

  if (process.env.LIVE_ADAPTERS === "all" || !base || !head || /^0+$/.test(base)) {
    print(liveAdapters);
    process.exit(0);
  }

  const diff = Bun.spawnSync(["git", "diff", "--name-only", base, head], {
    stdout: "pipe",
    stderr: "pipe",
  });

  if (diff.exitCode !== 0) {
    console.error(new TextDecoder().decode(diff.stderr).trim());
    process.exit(diff.exitCode);
  }

  const files = new TextDecoder()
    .decode(diff.stdout)
    .split("\n")
    .map((file) => file.trim())
    .filter(Boolean);

  print(selectLiveAdapters(files));
}

const sharedAdapterFiles = new Set([
  "packages/email-sdk/src/doctor.ts",
  "packages/email-sdk/src/doctor.test.ts",
  "packages/email-sdk/src/cli.ts",
  "scripts/changed-live-adapters.ts",
  "scripts/run-live-adapters.ts",
  "packages/email-sdk/src/core.ts",
  "packages/email-sdk/src/errors.ts",
  "packages/email-sdk/src/http.ts",
  "packages/email-sdk/src/payloads.ts",
  "packages/email-sdk/src/types.ts",
  "packages/email-sdk/src/utils.ts",
  "adapter-verification.json",
  ".depot/workflows/ci.yml",
]);

// Directories split out of core.ts, plus the shared adapter test fixtures.
const sharedAdapterPrefixes = [
  "packages/email-sdk/src/core/",
  "packages/email-sdk/src/internal/",
  "packages/email-sdk/test-support/",
];

function isSharedAdapterFile(file: string): boolean {
  return (
    sharedAdapterFiles.has(file) ||
    sharedAdapterPrefixes.some((prefix) => file.startsWith(prefix)) ||
    /^packages\/email-sdk\/src\/adapters\.[\w-]+\.test\.ts$/.test(file)
  );
}

if (import.meta.main) await main();
