import verification from "../adapter-verification.json";

const liveAdapters = Object.keys(verification.liveChecks).sort();
const [base, head] = process.argv.slice(2);

if (process.env.LIVE_ADAPTERS === "all" || !base || !head || /^0+$/.test(base)) {
  console.log(liveAdapters.join(" "));
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
const sharedAdapterFiles = new Set([
  "packages/email-sdk/src/core.ts",
  "packages/email-sdk/src/errors.ts",
  "packages/email-sdk/src/http.ts",
  "packages/email-sdk/src/payloads.ts",
  "packages/email-sdk/src/types.ts",
  "packages/email-sdk/src/utils.ts",
  "packages/email-sdk/src/adapters.test.ts",
  "adapter-verification.json",
  ".depot/workflows/ci.yml",
]);

if (files.some((file) => sharedAdapterFiles.has(file))) {
  console.log(liveAdapters.join(" "));
  process.exit(0);
}

const changed = liveAdapters.filter((adapter) =>
  files.some(
    (file) =>
      file === `packages/email-sdk/src/${adapter}.ts` ||
      file === `scripts/check-${adapter}-account.ts`,
  ),
);

console.log(changed.join(" "));
