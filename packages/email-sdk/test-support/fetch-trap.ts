import { stubFetch } from "./fetch.js";

// Preloaded into CLI subprocesses: prints every attempted request to stderr
// instead of sending it, so tests can assert which commands report telemetry.
globalThis.fetch = stubFetch(async (url) => {
  process.stderr.write(`FETCH_TRAP ${String(url)}\n`);

  return new Response("{}");
});
