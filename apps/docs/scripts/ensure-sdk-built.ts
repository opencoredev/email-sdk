import { existsSync } from "node:fs";
import { resolve } from "node:path";

const sdkDistEntries = [
  resolve(import.meta.dir, "../../../packages/email-sdk/dist/index.d.ts"),
  resolve(import.meta.dir, "../../../packages/email-sdk/dist/react.d.ts"),
];

if (sdkDistEntries.some((entry) => !existsSync(entry))) {
  const proc = Bun.spawnSync(["bun", "run", "--cwd", "../../packages/email-sdk", "build"], {
    cwd: resolve(import.meta.dir, ".."),
    stdout: "inherit",
    stderr: "inherit",
  });

  if (proc.exitCode !== 0) {
    process.exit(proc.exitCode ?? 1);
  }
}
