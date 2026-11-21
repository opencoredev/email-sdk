import { describe, expect, test } from "bun:test";

import { createEmailClient } from "./core.js";
import { EmailAdapterError, EmailRouteError } from "./errors.js";
import { failingAdapter, isTestAdapter, memoryAdapter } from "./testing.js";
import { adapter, message } from "../test-support/core-fixtures.js";

const context = { adapter: "memory", operation: "send", attempt: 1 } as const;

describe("memoryAdapter", () => {
  test("records each message with numbered ids and keeps the default name", async () => {
    const memory = memoryAdapter();
    const second = { ...message, subject: "Second" };

    expect(memory.name).toBe("memory");
    expect(await memory.send(message, context)).toEqual({ adapter: "memory", id: "mem_1" });
    expect(await memory.send(second, context)).toEqual({ adapter: "memory", id: "mem_2" });
    expect(memory.raw.sent.map((sent) => sent.message.subject)).toEqual(["Hello", "Second"]);
  });

  test("clear() empties the log in place, so held references see it and ids restart", async () => {
    const memory = memoryAdapter("inbox");
    const log = memory.raw.sent;

    await memory.send(message, context);
    memory.raw.clear();

    expect(log).toHaveLength(0);
    expect(await memory.send(message, context)).toEqual({ adapter: "inbox", id: "mem_1" });
  });

  test("declares capabilities that accept every SDK feature through a client", async () => {
    const memory = memoryAdapter();
    const client = createEmailClient({ adapters: [memory], telemetry: false });

    await client.send(
      {
        ...message,
        sendAt: "2030-01-01T00:00:00Z",
        headers: [
          { name: "X", value: "1" },
          { name: "X", value: "2" },
        ],
      },
      { idempotencyKey: "k" },
    );

    expect(memory.capabilities).toEqual({
      repeatedHeaders: true,
      idempotency: "native",
      scheduling: true,
      personalized: "expanded",
    });
    expect(memory.raw.sent).toHaveLength(1);
  });
});

describe("failingAdapter", () => {
  test("throws the exact error it was given", async () => {
    const cause = new Error("boom");
    const failing = failingAdapter("down", cause);

    expect(failing.name).toBe("down");
    expect(() => failing.send(message, context)).toThrow(cause);
  });

  test("defaults to a generic error, and a client wraps it in a route failure", async () => {
    const client = createEmailClient({ adapters: [failingAdapter()], telemetry: false });
    const error = await client.send(message).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(EmailRouteError);

    const [failure] = error instanceof EmailRouteError ? error.failures : [];
    expect(failure).toBeInstanceOf(EmailAdapterError);
    expect(failure?.message).toBe("Adapter failed");
  });
});

describe("isTestAdapter", () => {
  test("marks SDK test adapters, including after object spread and renaming", () => {
    const renamed = { ...memoryAdapter(), name: "resend" };

    expect(isTestAdapter(memoryAdapter())).toBe(true);
    expect(isTestAdapter(failingAdapter())).toBe(true);
    expect(isTestAdapter(renamed)).toBe(true);
  });

  test("does not mark ordinary adapters, even one named memory", () => {
    expect(isTestAdapter(adapter("memory"))).toBe(false);
  });
});
