import { describe, expect, test } from "bun:test";
import { createEmailClient } from "./core.js";
import { EmailAbortError, EmailAdapterError, EmailRouteError } from "./errors.js";
import { adapter, capabilities, message } from "../test-support/core-fixtures.js";
import { rejectionOf } from "../test-support/assertions.js";

describe("createEmailClient v1", () => {
  test("retries maxAttempts total calls", async () => {
    let calls = 0;

    const retrying = adapter("retrying", () => {
      calls += 1;

      if (calls < 3) {
        throw new EmailAdapterError("temporary", {
          adapter: "retrying",
          retryable: true,
          delivery: "not_sent",
        });
      }

      return { adapter: "retrying", id: "sent" };
    });

    const client = createEmailClient({
      adapters: [retrying],
      retry: { maxAttempts: 3, delay: () => 0 },
    });

    await expect(client.send(message)).resolves.toMatchObject({ id: "sent" });
    expect(calls).toBe(3);
  });

  test("falls back only for known not-sent outcomes unless explicitly opted in", async () => {
    let backupCalls = 0;

    const backup = adapter("backup", () => {
      backupCalls += 1;

      return { adapter: "backup", id: "ok" };
    });

    const safeClient = createEmailClient({
      adapters: [
        adapter("primary", () => {
          throw new EmailAdapterError("rejected", {
            adapter: "primary",
            delivery: "not_sent",
          });
        }),
        backup,
      ],
      fallback: { adapters: ["backup"] },
    });

    await expect(safeClient.send(message)).resolves.toMatchObject({ adapter: "backup" });
    expect(backupCalls).toBe(1);

    const unknownClient = createEmailClient({
      adapters: [
        adapter("primary", () => {
          throw new EmailAdapterError("timeout", {
            adapter: "primary",
            delivery: "unknown",
          });
        }),
        backup,
      ],
      fallback: { adapters: ["backup"] },
    });

    await expect(unknownClient.send(message)).rejects.toBeInstanceOf(EmailRouteError);
    expect(backupCalls).toBe(1);

    await expect(
      unknownClient.send(message, {
        fallback: { adapters: ["backup"], onUnknownDelivery: "continue" },
      }),
    ).resolves.toMatchObject({ adapter: "backup" });
    expect(backupCalls).toBe(2);
  });

  test("exposes ordered typed route failures", async () => {
    const client = createEmailClient({
      adapters: [
        adapter("one", () => {
          throw new EmailAdapterError("one failed", {
            adapter: "one",
            delivery: "not_sent",
          });
        }),
        adapter("two", () => {
          throw new EmailAdapterError("two failed", {
            adapter: "two",
            delivery: "not_sent",
          });
        }),
      ],
      fallback: { adapters: ["two"] },
    });

    const error = await rejectionOf(client.send(message), EmailRouteError);
    expect(error).toBeInstanceOf(EmailRouteError);
    expect(error.failures.map((failure) => failure.adapter)).toEqual(["one", "two"]);
  });

  test("aborts during backoff without retrying or falling back", async () => {
    const controller = new AbortController();
    let primaryCalls = 0;
    let backupCalls = 0;

    const client = createEmailClient({
      adapters: [
        adapter("primary", () => {
          primaryCalls += 1;
          throw new EmailAdapterError("retry", {
            adapter: "primary",
            retryable: true,
            delivery: "not_sent",
          });
        }),
        adapter("backup", () => {
          backupCalls += 1;

          return { adapter: "backup" };
        }),
      ],
      retry: { maxAttempts: 3, delay: () => 1_000 },
      fallback: { adapters: ["backup"] },
    });

    const sending = client.send(message, { signal: controller.signal });
    setTimeout(() => controller.abort("stop"), 5);
    await expect(sending).rejects.toBeInstanceOf(EmailAbortError);
    expect(primaryCalls).toBe(1);
    expect(backupCalls).toBe(0);
  });

  test("aborts when an adapter ignores the signal and resolves after cancellation", async () => {
    const controller = new AbortController();

    const client = createEmailClient({
      adapters: [
        adapter("slow", async () => {
          await Bun.sleep(20);

          return { adapter: "slow", id: "sent" };
        }),
      ],
    });

    const sending = client.send(message, { signal: controller.signal });
    setTimeout(() => controller.abort("stop"), 5);

    await expect(sending).rejects.toBeInstanceOf(EmailAbortError);
  });

  test("aborts native personalized sends that resolve after cancellation", async () => {
    const controller = new AbortController();

    const client = createEmailClient({
      adapters: [
        adapter("slow", undefined, {
          capabilities: { ...capabilities, personalized: "native" },
          async sendPersonalized() {
            await Bun.sleep(20);

            return {
              adapter: "slow",
              accepted: ["user@example.com"],
              rejected: [],
            };
          },
        }),
      ],
    });

    const sending = client.sendPersonalized(
      {
        message: { from: message.from, subject: "Hello", text: "Hello" },
        recipients: [{ to: "user@example.com", variables: {} }],
      },
      { signal: controller.signal },
    );

    setTimeout(() => controller.abort("stop"), 5);

    await expect(sending).rejects.toBeInstanceOf(EmailAbortError);
  });
});
