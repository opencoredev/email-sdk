import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const outputRoots = [
  join(import.meta.dirname, "..", ".output", "public"),
  join(import.meta.dirname, "..", ".vercel", "output", "static"),
];

for (const outputRoot of outputRoots) {
  const shellPath = join(outputRoot, "_shell.html");
  const indexPath = join(outputRoot, "index.html");

  if (!existsSync(shellPath) || existsSync(indexPath)) continue;

  copyFileSync(shellPath, indexPath);
  console.log(`Created ${indexPath} from ${shellPath}`);
}
