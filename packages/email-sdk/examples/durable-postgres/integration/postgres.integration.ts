import "dotenv/config";
import assert from "node:assert/strict";
import { createHmac, randomUUID } from "node:crypto";
import { after, before, beforeEach, test } from "node:test";
import {
  createEmailClient,
  EmailAdapterError,
  EmailMiddlewareError,
  type EmailAdapter,
} from "@opencoredev/email-sdk";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";
import {
  database,
  setup,
  transaction,
  enqueue,
  claim,
  complete,
  recover,
  runOne,
  backoff,
  reconcile,
  ingest,
  type Route,
  type DurableMessage,
} from "../src/durable.js";
import { webhook } from "../src/webhook.js";

const url = process.env.DURABLE_TEST_DATABASE_URL;
const schema = `durable_test_${randomUUID().replaceAll("-", "")}`;
const pool = url ? database(url, schema) : undefined;
const integration = url ? test : test.skip;
const message: DurableMessage = {
  from: "sender@example.test",
  to: ["to@example.test"],
  cc: ["cc@example.test"],
  bcc: ["bcc@example.test"],
  subject: "Fixture",
  text: "Never sent externally",
};
function fixture(send?: EmailAdapter["send"], provider = "resend", account = "fixture-account") {
  const adapter = memoryAdapter(provider);
  let calls = 0;
  const route: Route = {
    provider,
    account,
    email: createEmailClient({
      adapters: [
        {
          ...adapter,
          send: async (msg, context) => {
            calls++;
            return send ? send(msg, context) : { adapter: provider, id: `fixture_${randomUUID()}` };
          },
        },
      ],
      telemetry: false,
      retry: { maxAttempts: 1 },
    }),
  };
  return { route, calls: () => calls };
}
async function add(route: Route, key: string = randomUUID(), payload = message, maxAttempts = 3) {
  return transaction(pool!, (tx) => enqueue(tx, route, { key, message: payload, maxAttempts }));
}
async function row(id: string) {
  return (await pool!.query("SELECT * FROM jobs WHERE id=$1", [id])).rows[0];
}
async function due(id: string) {
  await pool!.query("UPDATE jobs SET next_at=now()-interval '1 second' WHERE id=$1", [id]);
}
async function expire(id: string) {
  await pool!.query("UPDATE jobs SET lease_until=now()-interval '1 second' WHERE id=$1", [id]);
}
function event(
  deliveryId: string,
  messageId: string,
  status: "delivered" | "bounced" | "complained",
  provider: "resend" | "postmark" = "resend",
) {
  return { provider, deliveryId, providerMessageId: messageId, status, payload: {} };
}
const secretBytes = Buffer.from("fixture-secret-not-a-real-credential");
const secret = `whsec_${secretBytes.toString("base64")}`;
function signedRequest(
  messageId: string,
  type = "email.delivered",
  deliveryId = randomUUID(),
  timestamp = Math.floor(Date.now() / 1000),
) {
  const body = JSON.stringify({ type, data: { email_id: messageId } });
  const signature = createHmac("sha256", secretBytes)
    .update(`${deliveryId}.${timestamp}.${body}`)
    .digest("base64");
  return new Request("http://localhost/webhooks/resend", {
    method: "POST",
    body,
    headers: {
      "svix-id": deliveryId,
      "svix-timestamp": String(timestamp),
      "svix-signature": `v1,${signature}`,
    },
  });
}
before(async () => {
  if (pool) await setup(pool, schema);
});
beforeEach(async () => {
  if (pool)
    await pool.query(
      "TRUNCATE reconciliations,suppressions,webhook_events,receipts,attempts,jobs,business_records CASCADE",
    );
});
after(async () => {
  if (pool) {
    try {
      await pool.query(`DROP SCHEMA "${schema}" CASCADE`);
    } finally {
      await pool.end();
    }
  }
});

integration(
  "actual PostgreSQL: concurrent enqueue deduplicates and detects payload/route/policy conflicts",
  async () => {
    const { route } = fixture();
    const ids = await Promise.all(Array.from({ length: 12 }, () => add(route, "same-key")));
    assert.equal(new Set(ids).size, 1);
    await assert.rejects(add(route, "same-key", { ...message, text: "changed" }), /conflict/);
    await assert.rejects(add({ ...route, account: "different" }, "same-key"), /conflict/);
    await assert.rejects(add(route, "same-key", message, 4), /conflict/);
    assert.equal((await pool!.query("SELECT count(*)::int AS n FROM jobs")).rows[0].n, 1);
  },
);
integration(
  "validation precedes persistence and business changes roll back with enqueue",
  async () => {
    const { route } = fixture();
    await assert.rejects(
      transaction(pool!, async (tx) => {
        await tx.query("INSERT INTO business_records VALUES('account','active')");
        await enqueue(tx, route, { key: "invalid", message: { ...message, to: ["invalid"] } });
      }),
    );
    await assert.rejects(
      transaction(pool!, async (tx) => {
        await tx.query("INSERT INTO business_records VALUES('account','active')");
        await enqueue(tx, route, { key: "rollback", message });
        throw new Error("business failed");
      }),
    );
    assert.equal(
      (await pool!.query("SELECT count(*)::int AS n FROM business_records")).rows[0].n,
      0,
    );
    assert.equal((await pool!.query("SELECT count(*)::int AS n FROM jobs")).rows[0].n, 0);
    await transaction(pool!, async (tx) => {
      await tx.query("INSERT INTO business_records VALUES('account','active')");
      await enqueue(tx, route, { key: "commit", message });
    });
    assert.equal(
      (await pool!.query("SELECT count(*)::int AS n FROM business_records")).rows[0].n,
      1,
    );
  },
);
integration("SKIP LOCKED concurrent workers claim each job only once", async () => {
  const { route, calls } = fixture();
  await Promise.all(Array.from({ length: 20 }, () => add(route)));
  await Promise.all(
    Array.from({ length: 8 }, async () => {
      while (await runOne(pool!, route)) {
        /* drain */
      }
    }),
  );
  assert.equal(calls(), 20);
  assert.equal(
    (await pool!.query("SELECT count(*)::int AS n FROM jobs WHERE state='accepted' AND attempts=1"))
      .rows[0].n,
    20,
  );
  assert.equal((await pool!.query("SELECT count(*)::int AS n FROM attempts")).rows[0].n, 20);
});
integration("locked candidate is skipped without blocking another claim", async () => {
  const { route } = fixture();
  const first = await add(route);
  const second = await add(route);
  const tx = await pool!.connect();
  try {
    await tx.query("BEGIN");
    await tx.query("SELECT id FROM jobs WHERE id=$1 FOR UPDATE", [first]);
    const job = await claim(pool!, route);
    assert.equal(job?.id, second);
  } finally {
    await tx.query("ROLLBACK");
    tx.release();
  }
});
integration(
  "expired inflight work is quarantined and stale tokens cannot complete or resend",
  async () => {
    const { route, calls } = fixture();
    const id = await add(route);
    const old = (await claim(pool!, route))!;
    await expire(id);
    assert.equal(await complete(pool!, old, { kind: "accepted", messageId: "late" }), false);
    assert.equal(await recover(pool!), 1);
    assert.equal((await row(id)).state, "needs_reconciliation");
    assert.equal(await runOne(pool!, route), false);
    assert.equal(calls(), 0);
    await reconcile(pool!, id, "not_sent", "provider-audit-123");
    await due(id);
    const fresh = (await claim(pool!, route))!;
    assert.notEqual(fresh.claim_token, old.claim_token);
    assert.equal(await complete(pool!, old, { kind: "accepted", messageId: "late" }), false);
    assert.equal(await complete(pool!, fresh, { kind: "accepted", messageId: "current" }), true);
    assert.equal(
      (await pool!.query("SELECT count(*)::int AS n FROM receipts WHERE message_id='late'")).rows[0]
        .n,
      0,
    );
  },
);
integration(
  "proven not_sent retry persists bounded backoff and exactly one SDK attempt per claim",
  async () => {
    const { route, calls } = fixture(() => {
      throw new EmailAdapterError("safe fixture", {
        adapter: "resend",
        delivery: "not_sent",
        retryable: true,
      });
    });
    const id = await add(route);
    for (let attempt = 1; attempt <= 3; attempt++) {
      await runOne(pool!, route);
      assert.equal(calls(), attempt);
      const job = await row(id);
      assert.equal(job.attempts, attempt);
      assert.equal(job.state, attempt < 3 ? "queued" : "failed");
      const delay = (
        await pool!.query(
          "SELECT extract(epoch FROM (next_at-updated_at))*1000 AS delay FROM jobs WHERE id=$1",
          [id],
        )
      ).rows[0].delay;
      assert.equal(Number(delay), backoff(attempt));
      assert.equal(await runOne(pool!, route), false);
      await due(id);
    }
    assert.equal(await claim(pool!, route), undefined);
    assert.equal(backoff(100), 60000);
  },
);
integration(
  "unknown, partial acceptance, middleware and generic failures never auto-retry",
  async () => {
    const failures = [
      new Error("unknown"),
      new EmailAdapterError("unknown", { adapter: "resend", retryable: true }),
      new EmailAdapterError("partial", {
        adapter: "resend",
        delivery: "not_sent",
        retryable: true,
        acceptedCount: 1,
      }),
      new EmailMiddlewareError("after_send", new Error("fixture")),
    ];
    for (const error of failures) {
      const { route, calls } = fixture(() => {
        throw error;
      });
      const id = await add(route);
      await runOne(pool!, route);
      assert.equal((await row(id)).state, "needs_reconciliation");
      assert.equal(await runOne(pool!, route), false);
      assert.equal(calls(), 1);
    }
    const { route } = fixture(() => ({
      adapter: "resend",
      id: "partial-receipt",
      accepted: [message.to[0]],
      rejected: [message.cc![0]],
    }));
    const id = await add(route);
    await runOne(pool!, route);
    assert.equal((await row(id)).state, "needs_reconciliation");
    assert.equal(
      (await pool!.query("SELECT job_id FROM receipts WHERE message_id='partial-receipt'")).rows[0]
        .job_id,
      id,
    );
  },
);
integration("terminal not_sent failure is failed rather than quarantined or retried", async () => {
  const { route, calls } = fixture(() => {
    throw new EmailAdapterError("terminal", { adapter: "resend", delivery: "not_sent" });
  });
  const id = await add(route);
  await runOne(pool!, route);
  assert.equal((await row(id)).state, "failed");
  assert.equal(await runOne(pool!, route), false);
  assert.equal(calls(), 1);
});
integration(
  "signed Resend replay persistence is atomic and bounce/complaint remain sticky",
  async () => {
    const { route } = fixture(() => ({ adapter: "resend", id: "provider-id" }));
    const id = await add(route);
    await runOne(pool!, route);
    const replay = randomUUID();
    const responses = await Promise.all(
      Array.from({ length: 8 }, () =>
        webhook(
          pool!,
          route.account,
          secret,
          signedRequest("provider-id", "email.bounced", replay),
        ),
      ),
    );
    assert.ok(responses.every((response) => response.status === 200));
    assert.equal((await pool!.query("SELECT count(*)::int AS n FROM webhook_events")).rows[0].n, 1);
    assert.equal((await row(id)).delivery, "bounced");
    await webhook(pool!, route.account, secret, signedRequest("provider-id", "email.delivered"));
    assert.equal((await row(id)).delivery, "bounced");
    await webhook(pool!, route.account, secret, signedRequest("provider-id", "email.complained"));
    await webhook(pool!, route.account, secret, signedRequest("provider-id", "email.bounced"));
    assert.equal((await row(id)).delivery, "complained");
    assert.equal(
      (await pool!.query("SELECT count(*)::int AS n FROM suppressions WHERE reason='complained'"))
        .rows[0].n,
      3,
    );
  },
);
integration(
  "pre-receipt inbox joins atomically with acceptance and scopes provider/account/message ID",
  async () => {
    const { route } = fixture();
    const id = await add(route);
    const job = (await claim(pool!, route))!;
    await ingest(pool!, "other-account", event("other", "same-id", "complained"));
    await ingest(
      pool!,
      route.account,
      event("other-provider", "same-id", "complained", "postmark"),
    );
    await webhook(pool!, route.account, secret, signedRequest("same-id", "email.bounced"));
    assert.equal((await pool!.query("SELECT count(*)::int AS n FROM suppressions")).rows[0].n, 0);
    await complete(pool!, job, { kind: "accepted", messageId: "same-id" });
    assert.equal((await row(id)).delivery, "bounced");
    const next = await add(route, randomUUID(), {
      ...message,
      to: ["other@example.test"],
      cc: undefined,
      bcc: undefined,
    });
    const nextJob = (await claim(pool!, route))!;
    await Promise.all([
      complete(pool!, nextJob, { kind: "accepted", messageId: "racing" }),
      ingest(pool!, route.account, event("race", "racing", "complained")),
    ]);
    assert.equal((await row(next)).delivery, "complained");
  },
);
integration(
  "suppression checks every to/cc/bcc recipient across every explicit route and account",
  async () => {
    await pool!.query("INSERT INTO suppressions(recipient,reason) VALUES($1,'bounced')", [
      "blocked@example.test",
    ]);
    for (const field of ["to", "cc", "bcc"] as const) {
      for (const provider of ["resend", "memory"]) {
        const { route, calls } = fixture(undefined, provider, `account-${provider}`);
        const id = await add(route, randomUUID(), {
          ...message,
          [field]: ["blocked@example.test"],
        });
        await runOne(pool!, route);
        assert.equal((await row(id)).state, "suppressed");
        assert.equal(calls(), 0);
      }
    }
  },
);
integration(
  "invalid/stale signatures persist nothing and persistence failure requests replay",
  async () => {
    assert.equal(
      (await webhook(pool!, "fixture-account", "wrong", signedRequest("id"))).status,
      401,
    );
    assert.equal(
      (
        await webhook(
          pool!,
          "fixture-account",
          secret,
          signedRequest("id", "email.delivered", randomUUID(), 1),
        )
      ).status,
      401,
    );
    assert.equal((await pool!.query("SELECT count(*)::int AS n FROM webhook_events")).rows[0].n, 0);
    await pool!.query(
      "ALTER TABLE webhook_events ADD CONSTRAINT fixture_failure CHECK(false) NOT VALID",
    );
    try {
      assert.equal(
        (await webhook(pool!, "fixture-account", secret, signedRequest("id"))).status,
        503,
      );
    } finally {
      await pool!.query("ALTER TABLE webhook_events DROP CONSTRAINT fixture_failure");
    }
    assert.equal((await pool!.query("SELECT count(*)::int AS n FROM webhook_events")).rows[0].n, 0);
  },
);
integration(
  "reconciliation requires evidence, respects retry bound, and attaches early delivery without sending",
  async () => {
    const { route, calls } = fixture();
    const id = await add(route);
    const job = (await claim(pool!, route))!;
    await expire(id);
    await recover(pool!);
    await assert.rejects(reconcile(pool!, id, "accepted", "", "verified"));
    await ingest(pool!, route.account, event("early", "verified", "delivered"));
    await reconcile(pool!, id, "accepted", "audit-ticket-321", "verified");
    assert.equal((await row(id)).state, "accepted");
    assert.equal((await row(id)).delivery, "delivered");
    assert.equal(await complete(pool!, job, { kind: "failed" }), false);
    assert.equal(calls(), 0);
    const bounded = await add(route, randomUUID(), message, 1);
    await claim(pool!, route);
    await expire(bounded);
    await recover(pool!);
    await reconcile(pool!, bounded, "not_sent", "verified-not-sent");
    assert.equal((await row(bounded)).state, "failed");
  },
);
