import { describe, expect, test } from "bun:test";

import { createEmailClient, type EmailPlugin } from "./compat.js";
import { EmailAdapterError } from "./errors.js";

const message = {
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Hello",
  text: "Hello",
};

describe("compat client", () => {
  test("translates provider vocabulary and exposes non-enumerable result aliases", async () => {
    const client = createEmailClient({
      providers: [
        {
          name: "legacy",
          send() {
            return { provider: "legacy", messageId: "legacy_1" };
          },
        },
      ],
      defaultProvider: "legacy",
      telemetry: false,
    });

    const result = await client.send(message, { provider: "legacy" });
    expect(result.adapter).toBe("legacy");
    expect(result.id).toBe("legacy_1");
    expect(result.provider).toBe("legacy");
    expect(result.messageId).toBe("legacy_1");
    expect(Object.keys(result)).toEqual(["adapter", "id", "accepted", "rejected", "raw"]);
    expect(client.defaultProvider).toBe("legacy");
    expect(client.provider("legacy").name).toBe("legacy");
  });

  test("translates retries into total maxAttempts", async () => {
    let calls = 0;
    const client = createEmailClient({
      providers: [
        {
          name: "legacy",
          capabilities: {
            repeatedHeaders: false,
            idempotency: "none",
            scheduling: false,
            personalized: "expanded",
          },
          send() {
            calls += 1;
            throw new EmailAdapterError("retry", {
              adapter: "legacy",
              retryable: true,
              delivery: "not_sent",
            });
          },
        },
      ],
      retry: { retries: 2, delay: () => 0 },
      telemetry: false,
    });

    await expect(client.send(message)).rejects.toThrow("All configured email adapters failed");
    expect(calls).toBe(3);
  });

  test("translates sendBatch and message-level idempotency", async () => {
    const keys: Array<string | undefined> = [];
    const client = createEmailClient({
      providers: [
        {
          name: "legacy",
          capabilities: {
            repeatedHeaders: true,
            idempotency: "native",
            scheduling: true,
            personalized: "expanded",
          },
          send(_message, context: { idempotencyKey?: string }) {
            keys.push(context.idempotencyKey);
            return { adapter: "legacy", id: "ok" };
          },
        },
      ],
      telemetry: false,
    });

    const results = await client.sendBatch([{ ...message, idempotencyKey: "legacy-key" }]);
    expect(results[0]).toMatchObject({ ok: true, index: 0 });
    expect(keys).toEqual(["legacy-key"]);
  });

  test("translates legacy hook event fields", async () => {
    const events: string[] = [];
    const client = createEmailClient({
      providers: [
        {
          name: "legacy",
          send() {
            return { provider: "legacy", messageId: "legacy_1" };
          },
        },
      ],
      hooks: {
        beforeSend(event) {
          events.push(`before:${event.provider}`);
        },
        afterSend(event) {
          events.push(`after:${event.response.provider}`);
        },
      },
      telemetry: false,
    });

    await client.send(message);
    expect(events).toEqual(["before:legacy", "after:legacy"]);
  });

  test("adapts legacy plugin adapters and client extensions", async () => {
    const plugin = {
      id: "legacy-plugin",
      adapters: [
        {
          name: "plugin-adapter",
          send() {
            return { provider: "plugin-adapter", messageId: "plugin_1" };
          },
        },
      ],
      extendClient() {
        return { pluginValue: "legacy" as const };
      },
    } satisfies EmailPlugin<{ pluginValue: "legacy" }>;
    const client = createEmailClient({ plugins: [plugin], telemetry: false });

    await expect(client.send(message)).resolves.toMatchObject({ provider: "plugin-adapter" });
    expect(client.pluginValue).toBe("legacy");
  });

  test("preserves recipientVariables in sendBatch", async () => {
    const batches: unknown[] = [];
    const client = createEmailClient({
      providers: [
        {
          name: "legacy",
          send() {
            throw new Error("send should not run for recipientVariables");
          },
          sendBulk(batch) {
            batches.push(batch.recipientVariables);
            return { provider: "legacy", messageId: "bulk_1" };
          },
        },
      ],
      telemetry: false,
    });

    const results = await client.sendBatch([
      {
        ...message,
        recipientVariables: { "user@example.com": { name: "Ada" } },
      },
    ]);

    expect(results[0]).toMatchObject({ ok: true, response: { provider: "legacy" } });
    expect(batches).toEqual([{ "user@example.com": { name: "Ada" } }]);
  });
});
