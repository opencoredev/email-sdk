import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool, type PoolClient } from "pg";
import {
  EmailAdapterError,
  EmailRouteError,
  type EmailClient,
  type EmailMessage,
  type EmailSendResult,
} from "@opencoredev/email-sdk";
import type { NormalizedWebhookEvent } from "@opencoredev/email-sdk/webhooks";

export type DurableMessage = {
  from: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  text: string;
};
export type Job = {
  id: string;
  provider: string;
  account: string;
  message: DurableMessage;
  recipients: string[];
  state: string;
  attempts: number;
  max_attempts: number;
  claim_token: string;
  delivery: string | null;
};
export type Route = {
  provider: string;
  account: string;
  email: Pick<EmailClient, "validate" | "send">;
};
export type EnqueueInput = { key: string; message: DurableMessage; maxAttempts?: number };
export type Outcome =
  | { kind: "accepted"; messageId: string }
  | { kind: "needs_reconciliation"; messageId?: string }
  | { kind: "retry" | "failed" | "suppressed" };

export function database(url: string, schema = "durable_email"): Pool {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid schema name");
  return new Pool({ connectionString: url, options: `-c search_path=${schema}`, max: 10 });
}
export async function setup(pool: Pool, schema = "durable_email") {
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(schema)) throw new Error("Invalid schema name");
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schema}"`);
  await pool.query(await readFile(new URL("./schema.sql", import.meta.url), "utf8"));
}
export async function transaction<T>(pool: Pool, run: (tx: PoolClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await run(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
function normalize(input: DurableMessage): DurableMessage {
  const allowed = ["from", "to", "cc", "bcc", "subject", "text"];
  if (!input || Object.keys(input).some((key) => !allowed.includes(key)))
    throw new Error("Unsupported durable message field");
  const address = (value: unknown): string => {
    if (typeof value !== "string" || !/^[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+$/.test(value))
      throw new Error("Use bare email addresses");
    return value.toLowerCase();
  };
  const addresses = (value: unknown): string[] => {
    if (!Array.isArray(value) || !value.length)
      throw new Error("Recipients must be nonempty arrays");
    return value.map(address);
  };
  if (typeof input.subject !== "string" || typeof input.text !== "string")
    throw new Error("Subject and text required");
  return {
    from: address(input.from),
    to: addresses(input.to),
    ...(input.cc ? { cc: addresses(input.cc) } : {}),
    ...(input.bcc ? { bcc: addresses(input.bcc) } : {}),
    subject: input.subject,
    text: input.text,
  };
}
export async function enqueue(tx: PoolClient, route: Route, input: EnqueueInput): Promise<string> {
  const message = normalize(input.message);
  const maxAttempts = input.maxAttempts ?? 3;
  if (
    !input.key?.trim() ||
    input.key.length > 200 ||
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > 10
  )
    throw new Error("Invalid enqueue policy");
  await route.email.validate(message, {
    adapter: route.provider,
    fallback: { adapters: [], onUnknownDelivery: "stop" },
    retry: { maxAttempts: 1 },
  });
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({ provider: route.provider, account: route.account, message, maxAttempts }),
    )
    .digest("hex");
  const id = randomUUID();
  const result = await tx.query<{ id: string; fingerprint: string }>(
    `INSERT INTO jobs(id,business_key,fingerprint,provider,account,message,recipients,max_attempts)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(business_key) DO UPDATE SET business_key=EXCLUDED.business_key RETURNING id,fingerprint`,
    [
      id,
      input.key,
      fingerprint,
      route.provider,
      route.account,
      message,
      [...new Set([...message.to, ...(message.cc ?? []), ...(message.bcc ?? [])])],
      maxAttempts,
    ],
  );
  if (result.rows[0].fingerprint !== fingerprint) throw new Error("Business key payload conflict");
  return result.rows[0].id;
}
export async function recover(pool: Pool): Promise<number> {
  return transaction(pool, async (tx) => {
    const expired =
      await tx.query(`UPDATE jobs SET state='needs_reconciliation',claim_token=NULL,lease_until=NULL,updated_at=now()
      WHERE state='inflight' AND lease_until<=now() RETURNING id,attempts`);
    for (const row of expired.rows)
      await tx.query(
        "UPDATE attempts SET outcome='lease_expired',finished_at=now() WHERE job_id=$1 AND number=$2",
        [row.id, row.attempts],
      );
    return expired.rowCount ?? 0;
  });
}
export async function claim(pool: Pool, route: Route, leaseMs = 30000): Promise<Job | undefined> {
  if (!Number.isInteger(leaseMs) || leaseMs < 1) throw new Error("Invalid lease");
  return transaction(pool, async (tx) => {
    const result = await tx.query<Job>(
      `WITH candidate AS (
      SELECT id FROM jobs WHERE state='queued' AND next_at<=now() AND attempts<max_attempts AND provider=$1 AND account=$2
      ORDER BY next_at,id FOR UPDATE SKIP LOCKED LIMIT 1)
      UPDATE jobs SET state='inflight',attempts=attempts+1,claim_token=$3,lease_until=now()+$4*interval '1 millisecond',updated_at=now()
      FROM candidate WHERE jobs.id=candidate.id RETURNING jobs.*`,
      [route.provider, route.account, randomUUID(), leaseMs],
    );
    const job = result.rows[0];
    if (job)
      await tx.query("INSERT INTO attempts(job_id,number,token) VALUES($1,$2,$3)", [
        job.id,
        job.attempts,
        job.claim_token,
      ]);
    return job;
  });
}
export function backoff(attempt: number): number {
  return Math.min(60000, 1000 * 2 ** Math.min(16, Math.max(0, attempt - 1)));
}
export function classify(error: unknown): Outcome {
  if (error instanceof EmailRouteError && error.failures.length === 1)
    return classify(error.failures[0]);
  if (
    error instanceof EmailAdapterError &&
    error.delivery === "not_sent" &&
    !(error.acceptedCount && error.acceptedCount > 0)
  )
    return { kind: error.retryable ? "retry" : "failed" };
  return { kind: "needs_reconciliation" };
}
function resultOutcome(result: EmailSendResult, job: Job): Outcome {
  if (
    result.adapter !== job.provider ||
    !result.id ||
    result.rejected?.length ||
    (result.accepted &&
      job.recipients.some(
        (recipient) => !result.accepted!.map((value) => value.toLowerCase()).includes(recipient),
      ))
  )
    return {
      kind: "needs_reconciliation",
      ...(result.adapter === job.provider && result.id ? { messageId: result.id } : {}),
    };
  return { kind: "accepted", messageId: result.id };
}
async function correlationLock(
  tx: PoolClient,
  provider: string,
  account: string,
  messageId: string,
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    JSON.stringify([provider, account, messageId]),
  ]);
}
async function applyEvents(tx: PoolClient, provider: string, account: string, messageId: string) {
  const receipt = await tx.query<{ job_id: string }>(
    "SELECT job_id FROM receipts WHERE provider=$1 AND account=$2 AND message_id=$3",
    [provider, account, messageId],
  );
  if (!receipt.rows[0]) return;
  const events = await tx.query<{ status: string }>(
    "SELECT status FROM webhook_events WHERE provider=$1 AND account=$2 AND message_id=$3 AND status IS NOT NULL",
    [provider, account, messageId],
  );
  const status = events.rows.some((e) => e.status === "complained")
    ? "complained"
    : events.rows.some((e) => e.status === "bounced")
      ? "bounced"
      : events.rows.length
        ? "delivered"
        : null;
  if (!status) return;
  const jobId = receipt.rows[0].job_id;
  await tx.query(
    `UPDATE jobs SET delivery=CASE WHEN delivery='complained' THEN delivery WHEN delivery='bounced' AND $2='delivered' THEN delivery ELSE $2 END,updated_at=now() WHERE id=$1`,
    [jobId, status],
  );
  if (status !== "delivered")
    await tx.query(
      `INSERT INTO suppressions(recipient,reason) SELECT unnest(recipients),$2 FROM jobs WHERE id=$1 ON CONFLICT(recipient) DO UPDATE SET reason=CASE WHEN suppressions.reason='complained' THEN suppressions.reason ELSE EXCLUDED.reason END`,
      [jobId, status],
    );
}
async function receipt(tx: PoolClient, job: Job, messageId: string) {
  await correlationLock(tx, job.provider, job.account, messageId);
  const existing = await tx.query<{ job_id: string }>(
    `INSERT INTO receipts(provider,account,message_id,job_id) VALUES($1,$2,$3,$4)
    ON CONFLICT(provider,account,message_id) DO UPDATE SET message_id=EXCLUDED.message_id RETURNING job_id`,
    [job.provider, job.account, messageId, job.id],
  );
  if (existing.rows[0].job_id !== job.id) throw new Error("Receipt correlation conflict");
  await applyEvents(tx, job.provider, job.account, messageId);
}
export async function complete(pool: Pool, job: Job, outcome: Outcome): Promise<boolean> {
  return transaction(pool, async (tx) => {
    if ("messageId" in outcome && outcome.messageId)
      await correlationLock(tx, job.provider, job.account, outcome.messageId);
    const locked = await tx.query(
      "SELECT id FROM jobs WHERE id=$1 AND claim_token=$2 AND state='inflight' AND lease_until>clock_timestamp() FOR UPDATE",
      [job.id, job.claim_token],
    );
    if (!locked.rowCount) return false;
    const state =
      outcome.kind === "retry"
        ? job.attempts < job.max_attempts
          ? "queued"
          : "failed"
        : outcome.kind;
    await tx.query(
      "UPDATE jobs SET state=$3,claim_token=NULL,lease_until=NULL,next_at=now()+$4*interval '1 millisecond',updated_at=now() WHERE id=$1 AND claim_token=$2",
      [job.id, job.claim_token, state, backoff(job.attempts)],
    );
    await tx.query("UPDATE attempts SET outcome=$2,finished_at=now() WHERE token=$1", [
      job.claim_token,
      outcome.kind,
    ]);
    if ("messageId" in outcome && outcome.messageId) await receipt(tx, job, outcome.messageId);
    return true;
  });
}
export async function runOne(pool: Pool, route: Route): Promise<boolean> {
  await recover(pool);
  const job = await claim(pool, route);
  if (!job) return false;
  // Recheck the fence and all recipients immediately before the single route attempt.
  const check = await pool.query(
    `SELECT EXISTS(SELECT 1 FROM suppressions WHERE recipient=ANY($3::text[])) AS suppressed
    FROM jobs WHERE id=$1 AND claim_token=$2 AND state='inflight' AND lease_until>clock_timestamp()`,
    [job.id, job.claim_token, job.recipients],
  );
  if (!check.rows[0]) return true;
  let outcome: Outcome;
  if (check.rows[0].suppressed) outcome = { kind: "suppressed" };
  else {
    try {
      outcome = resultOutcome(
        await route.email.send(job.message as EmailMessage, {
          adapter: route.provider,
          idempotencyKey: job.id,
          fallback: { adapters: [], onUnknownDelivery: "stop" },
          retry: { maxAttempts: 1 },
          signal: AbortSignal.timeout(20000),
        }),
        job,
      );
    } catch (error) {
      outcome = classify(error);
    }
  }
  await complete(pool, job, outcome);
  return true;
}
export async function ingest(
  pool: Pool,
  account: string,
  event: NormalizedWebhookEvent,
): Promise<boolean> {
  return transaction(pool, async (tx) => {
    if (event.providerMessageId)
      await correlationLock(tx, event.provider, account, event.providerMessageId);
    const inserted = await tx.query(
      `INSERT INTO webhook_events(provider,account,delivery_id,message_id,status) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT DO NOTHING RETURNING delivery_id`,
      [
        event.provider,
        account,
        event.deliveryId,
        event.providerMessageId ?? null,
        event.status ?? null,
      ],
    );
    if (!inserted.rowCount) return false;
    if (event.providerMessageId)
      await applyEvents(tx, event.provider, account, event.providerMessageId);
    return true;
  });
}
export async function reconcile(
  pool: Pool,
  id: string,
  decision: "accepted" | "not_sent" | "abandon",
  evidence: string,
  messageId?: string,
) {
  if (!evidence.trim() || evidence.length > 300 || (decision === "accepted" && !messageId))
    throw new Error("External evidence reference required");
  await transaction(pool, async (tx) => {
    if (decision === "accepted") {
      const snapshot = await tx.query<Job>("SELECT * FROM jobs WHERE id=$1", [id]);
      if (!snapshot.rows[0]) throw new Error("Unknown job");
      await correlationLock(tx, snapshot.rows[0].provider, snapshot.rows[0].account, messageId!);
    }
    const result = await tx.query<Job>(
      "SELECT * FROM jobs WHERE id=$1 AND state='needs_reconciliation' FOR UPDATE",
      [id],
    );
    const job = result.rows[0];
    if (!job) throw new Error("Job is not awaiting reconciliation");
    if (decision === "not_sent") {
      const knownReceipt = await tx.query("SELECT 1 FROM receipts WHERE job_id=$1 LIMIT 1", [id]);
      if (knownReceipt.rowCount || job.delivery) throw new Error("Receipt evidence forbids whole-job resend");
    }
    const state =
      decision === "accepted"
        ? "accepted"
        : decision === "not_sent" && job.attempts < job.max_attempts
          ? "queued"
          : "failed";
    await tx.query(
      "UPDATE jobs SET state=$2,next_at=now()+$3*interval '1 millisecond',updated_at=now() WHERE id=$1",
      [id, state, backoff(job.attempts)],
    );
    await tx.query("INSERT INTO reconciliations(job_id,decision,evidence) VALUES($1,$2,$3)", [
      id,
      decision,
      evidence,
    ]);
    if (decision === "accepted") await receipt(tx, job, messageId!);
  });
}
