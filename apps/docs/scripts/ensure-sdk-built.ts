import { existsSync } from "node:fs";
import { resolve } from "node:path";

const sdkReactTypes = resolve(import.meta.dir, "../../../packages/email-sdk/dist/react/index.d.ts");

if (!existsSync(sdkReactTypes)) {
  const proc = Bun.spawnSync(["bun", "run", "--cwd", "../../packages/email-sdk", "build"], {
    cwd: resolve(import.meta.dir, ".."),
    stdout: "inherit",
    stderr: "inherit",
  });

  if (proc.exitCode !== 0) {
    process.exit(proc.exitCode ?? 1);
  }
}
