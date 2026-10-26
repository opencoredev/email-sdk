/**
 * The idempotency key `ctx.send` passes for a run's step: `wf_` plus the SHA-256 of the
 * JSON-encoded `[runId, step]` pair, in hex. JSON encoding keeps the tuple unambiguous (run `a:b`
 * with step `c` and run `a` with step `b:c` get different keys), and the hash keeps every key at 67
 * characters, inside provider limits however long the ids are.
 */
export async function workflowIdempotencyKey(runId: string, step: string): Promise<string> {
  const encoded = new TextEncoder().encode(JSON.stringify([runId, step]));
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));

  return `wf_${Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}
