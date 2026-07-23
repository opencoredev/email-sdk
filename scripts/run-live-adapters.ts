import verification from "../adapter-verification.json";

type LiveAdapter = keyof typeof verification.liveChecks;

const requested = process.argv.slice(2).flatMap((value) => value.split(/\s+/)).filter(Boolean);
const known = new Set(Object.keys(verification.liveChecks));
const environment = { ...process.env };

for (const key of Object.keys(environment)) {
  if (key.endsWith("_LIVE_SEND")) delete environment[key];
}

for (const adapter of requested) {
  if (!known.has(adapter)) {
    console.error(`Unknown live adapter check: ${adapter}`);
    process.exit(1);
  }

  const check = verification.liveChecks[adapter as LiveAdapter];
  console.log(`Running non-sending ${adapter} authentication check...`);
  const process = Bun.spawn(check.command.split(" "), {
    env: environment,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
  });

  const exitCode = await process.exited;
  if (exitCode !== 0) process.exit(exitCode);
}

if (requested.length === 0) {
  console.log("No live adapter checks selected.");
}
