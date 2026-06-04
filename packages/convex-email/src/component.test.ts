import { afterEach, describe, expect, test } from "bun:test";
import { convexTest, type TestConvex } from "convex-test";

import { api } from "./component/_generated/api.js";
import schema from "./component/schema.js";
import { buildEmailClient, hydrateAttachments } from "./component/providers.js";

const modules = {
  "./component/_generated/api.ts": () => import("./component/_generated/api.js"),
  "./component/_generated/server.ts": () => import("./component/_generated/server.js"),
  "./component/lib.ts": () => import("./component/lib.js"),
  "./component/providers.ts": () => import("./component/providers.js"),
  "./component/worker.ts": () => import("./component/worker.js"),
};

function createTest() {
  return convexTest(schema, modules);
}

async function flushScheduled(t: TestConvex<typeof schema>) {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await t.finishInProgressScheduledFunctions();
}

const message = {
  from: "Acme <hello@example.com>",
  to: "ada@example.com",
  subject: "Welcome",
  text: "Your account is ready.",
};

describe("convex-email component", () => {
  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_PORT;
    delete process.env.SMTP_SECURE;
  });

  test("queues a memory-adapter email and records sent status", async () => {
    const t = createTest();
    const emailId = await t.mutation(api.lib.enqueue, {
      ...message,
      adapters: [{ kind: "memory" }],
      adapter: "memory",
      maxAttempts: 1,
    });

    await flushScheduled(t);

    const status = await t.query(api.lib.status, { emailId });
    const events = await t.query(api.lib.listEvents, { emailId });

    expect(status).toMatchObject({
      status: "sent",
      attemptedAdapters: ["memory"],
      providerMessageId: expect.any(String),
    });
    expect(events.map((event) => event.type)).toEqual(["queued", "processing", "provider_attempt", "sent"]);
  });

  test("marks emails failed when no adapter can be built", async () => {
    const t = createTest();
    const emailId = await t.mutation(api.lib.enqueue, {
      ...message,
      adapters: [],
      maxAttempts: 1,
    });

    await flushScheduled(t);

    const status = await t.query(api.lib.status, { emailId });
    const events = await t.query(api.lib.listEvents, { emailId });

    expect(status).toMatchObject({
      status: "failed",
      lastError: "Convex Email requires at least one adapter configuration.",
    });
    expect(events.map((event) => event.type)).toContain("failed");
  });

  test("returns the existing email id for duplicate idempotency keys", async () => {
    const t = createTest();
    const firstId = await t.mutation(api.lib.enqueue, {
      ...message,
      idempotencyKey: "welcome:ada@example.com",
      adapters: [{ kind: "memory" }],
      adapter: "memory",
    });
    const secondId = await t.mutation(api.lib.enqueue, {
      ...message,
      subject: "Duplicate",
      idempotencyKey: "welcome:ada@example.com",
      adapters: [{ kind: "memory" }],
      adapter: "memory",
    });

    expect(secondId).toBe(firstId);
  });

  test("limits batch size to avoid mutation operation blowups", async () => {
    const t = createTest();

    await expect(
      t.mutation(api.lib.enqueueBatch, {
        messages: Array.from({ length: 101 }, () => ({
          ...message,
          adapters: [{ kind: "memory" }],
          adapter: "memory",
        })),
      }),
    ).rejects.toThrow("sendBatch accepts at most 100 messages");
  });

  test("test mode redirects recipients and strips copied recipients", async () => {
    const t = createTest();

    await t.mutation(api.lib.setConfig, {
      config: {
        testMode: true,
        sandboxTo: ["dev@example.test"],
        defaultFrom: "Ops <ops@example.com>",
      },
    });
    const emailId = await t.mutation(api.lib.enqueue, {
      to: "real@example.com",
      cc: "cc@example.com",
      bcc: "bcc@example.com",
      subject: "Sandbox",
      text: "Redirect me.",
      adapters: [{ kind: "memory" }],
      adapter: "memory",
    });

    const status = await t.query(api.lib.status, { emailId });

    expect(status?.message).toMatchObject({
      from: "Ops <ops@example.com>",
      to: ["dev@example.test"],
      metadata: { convexEmailTestMode: true },
    });
    expect(status?.message.cc).toBeUndefined();
    expect(status?.message.bcc).toBeUndefined();
  });

  test("test mode requires sandbox recipients", async () => {
    const t = createTest();

    await t.mutation(api.lib.setConfig, {
      config: {
        testMode: true,
        defaultFrom: "Ops <ops@example.com>",
      },
    });

    await expect(
      t.mutation(api.lib.enqueue, {
        to: "real@example.com",
        subject: "Sandbox",
        text: "This should not send.",
        adapters: [{ kind: "memory" }],
        adapter: "memory",
      }),
    ).rejects.toThrow("testMode is enabled but sandboxTo is not configured");
  });

  test("records duplicate webhook deliveries idempotently", async () => {
    const t = createTest();
    const args = {
      provider: "resend",
      headers: { "svix-id": "evt_duplicate" },
      body: JSON.stringify({ data: { email_id: "msg_123" } }),
    };

    const first = await t.action(api.worker.handleWebhook, args);
    const second = await t.action(api.worker.handleWebhook, args);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true, duplicate: true });
  });

  test("deduplicates generic webhooks without provider delivery ids", async () => {
    const t = createTest();
    const args = {
      provider: "postmark",
      headers: {},
      body: JSON.stringify({ type: "delivered", message_id: "msg_generic" }),
    };

    const first = await t.action(api.worker.handleWebhook, args);
    const second = await t.action(api.worker.handleWebhook, args);

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: true, duplicate: true });
  });

  test("SMTP adapter reads numeric port from component environment", () => {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_PORT = "2525";
    process.env.SMTP_SECURE = "false";

    expect(() =>
      buildEmailClient({
        adapters: [{ kind: "smtp" }],
        defaultAdapter: "smtp",
      }),
    ).not.toThrow();
  });

  test("rejects unsafe attachment URLs before server-side fetch", async () => {
    await expect(
      hydrateAttachments({
        ...message,
        attachments: [{ filename: "metadata.txt", url: "http://169.254.169.254/latest" }],
      }),
    ).rejects.toThrow('Attachment "metadata.txt" URL must use https.');

    await expect(
      hydrateAttachments({
        ...message,
        attachments: [{ filename: "loopback.txt", url: "https://127.0.0.1/private" }],
      }),
    ).rejects.toThrow('Attachment "loopback.txt" URL host is not allowed.');
  });

  test("recovers emails stuck in processing", async () => {
    const t = createTest();
    const originalNow = Date.now;
    const startedAt = 1_000;

    Date.now = () => startedAt;
    try {
      const emailId = await t.mutation(api.lib.enqueue, {
        ...message,
        adapters: [{ kind: "memory" }],
        adapter: "memory",
        maxAttempts: 2,
      });

      await t.mutation(api.lib.markProcessing, { emailId });
      Date.now = () => startedAt + 10 * 60 * 1_000 + 1;

      const recovered = await t.mutation(api.lib.processDueEmails, { limit: 25 });
      const status = await t.query(api.lib.status, { emailId });
      const events = await t.query(api.lib.listEvents, { emailId });

      expect(recovered).toBe(1);
      expect(status).toMatchObject({
        status: "queued",
        lastError: "Email processing exceeded recovery timeout.",
      });
      expect(events.map((event) => event.type)).toContain("retry_scheduled");
    } finally {
      Date.now = originalNow;
    }
  });

  test("cleanupAfterDays removes expired email history", async () => {
    const t = createTest();
    const originalNow = Date.now;
    const createdAt = 1_000;

    Date.now = () => createdAt;
    try {
      await t.mutation(api.lib.setConfig, {
        config: { cleanupAfterDays: 1 },
      });
      const emailId = await t.mutation(api.lib.enqueue, {
        ...message,
        adapters: [{ kind: "memory" }],
        adapter: "memory",
        maxAttempts: 1,
      });
      await flushScheduled(t);

      Date.now = () => createdAt + 2 * 24 * 60 * 60 * 1_000;
      const deleted = await t.mutation(api.lib.cleanupExpiredEmails, { limit: 25 });
      const status = await t.query(api.lib.status, { emailId });
      const events = await t.query(api.lib.listEvents, { emailId });

      expect(deleted).toBe(1);
      expect(status).toBeNull();
      expect(events).toEqual([]);
    } finally {
      Date.now = originalNow;
    }
  });

  test("cleanupAfterDays keeps non-terminal emails", async () => {
    const t = createTest();
    const originalNow = Date.now;
    const createdAt = 1_000;

    Date.now = () => createdAt;
    try {
      await t.mutation(api.lib.setConfig, {
        config: { cleanupAfterDays: 1 },
      });
      const emailId = await t.mutation(api.lib.enqueue, {
        ...message,
        adapters: [{ kind: "memory" }],
        adapter: "memory",
        maxAttempts: 1,
      });

      Date.now = () => createdAt + 2 * 24 * 60 * 60 * 1_000;
      const deleted = await t.mutation(api.lib.cleanupExpiredEmails, { limit: 25 });
      const status = await t.query(api.lib.status, { emailId });

      expect(deleted).toBe(0);
      expect(status?.status).toBe("queued");
    } finally {
      Date.now = originalNow;
    }
  });

  test("cleanupAfterDays reaches expired terminal emails when active emails fill the batch", async () => {
    const t = createTest();
    const originalNow = Date.now;
    const createdAt = 1_000;

    Date.now = () => createdAt;
    try {
      await t.mutation(api.lib.setConfig, {
        config: { cleanupAfterDays: 1 },
      });
      const terminalEmailId = await t.mutation(api.lib.enqueue, {
        ...message,
        adapters: [{ kind: "memory" }],
        adapter: "memory",
        maxAttempts: 1,
      });
      await flushScheduled(t);

      for (let index = 0; index < 60; index += 1) {
        await t.mutation(api.lib.enqueue, {
          ...message,
          to: `active-${index}@example.com`,
          adapters: [{ kind: "memory" }],
          adapter: "memory",
          maxAttempts: 1,
        });
      }

      Date.now = () => createdAt + 2 * 24 * 60 * 60 * 1_000;
      const deleted = await t.mutation(api.lib.cleanupExpiredEmails, { limit: 25 });
      const terminalStatus = await t.query(api.lib.status, { emailId: terminalEmailId });

      expect(deleted).toBe(1);
      expect(terminalStatus).toBeNull();
    } finally {
      Date.now = originalNow;
    }
  });
});
