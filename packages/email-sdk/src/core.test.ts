import { describe, expect, test } from "bun:test";

import { createEmailClient } from "./core.js";
import { EmailProviderError, EmailValidationError } from "./errors.js";
import { failingProvider, memoryProvider } from "./testing.js";

const message = {
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Welcome",
  text: "Hello",
};

describe("createEmailClient", () => {
  test("sends with the default provider", async () => {
    const provider = memoryProvider();
    const client = createEmailClient({ adapters: [provider] });

    const response = await client.send(message);

    expect(response.provider).toBe("memory");
    expect(provider.raw.sent).toHaveLength(1);
  });

  test("falls back to another provider", async () => {
    const client = createEmailClient({
      adapters: [failingProvider(), memoryProvider("backup")],
      fallback: ["backup"],
    });

    const response = await client.send(message);

    expect(response.provider).toBe("backup");
  });

  test("keeps legacy provider aliases working", async () => {
    const client = createEmailClient({
      providers: [failingProvider(), memoryProvider("backup")],
    });

    const response = await client.send(message, {
      provider: "failing",
      fallbackProviders: ["backup"],
    });

    expect(response.provider).toBe("backup");
    expect(client.providers.get("backup")).toBe(client.adapters.get("backup"));
  });

  test("supports adapter-first routing aliases", async () => {
    const client = createEmailClient({
      adapters: [memoryProvider("primary"), memoryProvider("backup")],
      defaultAdapter: "primary",
    });

    const response = await client.send(message, {
      adapter: "backup",
    });

    expect(client.defaultAdapter).toBe("primary");
    expect(client.adapter("backup")).toBe(client.provider("backup"));
    expect(response.provider).toBe("backup");
  });

  test("retries retryable provider errors", async () => {
    let attempts = 0;
    const provider = {
      name: "retry",
      send() {
        attempts += 1;

        if (attempts === 1) {
          throw new EmailProviderError("Temporary failure", {
            provider: "retry",
            retryable: true,
          });
        }

        return {
          provider: "retry",
          id: "ok",
        };
      },
    };

    const client = createEmailClient({
      adapters: [provider],
      retry: {
        retries: 1,
        delay: () => 0,
      },
    });

    const response = await client.send(message);

    expect(response.id).toBe("ok");
    expect(attempts).toBe(2);
  });

  test("validates message content", async () => {
    const client = createEmailClient({ adapters: [memoryProvider()] });

    await expect(
      client.send({
        from: "hello@example.com",
        to: "user@example.com",
        subject: "No body",
      }),
    ).rejects.toBeInstanceOf(EmailValidationError);
  });

  test("captures batch failures without throwing", async () => {
    const client = createEmailClient({ adapters: [memoryProvider()] });
    const results = await client.sendBatch([
      message,
      {
        from: "hello@example.com",
        to: "user@example.com",
        subject: "Missing body",
      },
    ]);

    expect(results[0]?.ok).toBe(true);
    expect(results[1]?.ok).toBe(false);
  });

  test("lets item-level provider aliases override batch-level adapter aliases", async () => {
    const client = createEmailClient({
      adapters: [memoryProvider("primary"), memoryProvider("secondary")],
    });

    const [result] = await client.sendBatch([{ ...message, provider: "secondary" }], {
      adapter: "primary",
    });

    expect(result?.ok).toBe(true);
    if (result?.ok) {
      expect(result.response.provider).toBe("secondary");
    }
  });

  test("retries transient runtime errors from provider transports", async () => {
    let attempts = 0;
    const provider = {
      name: "runtime",
      send() {
        attempts += 1;

        if (attempts === 1) {
          throw new TypeError("fetch failed");
        }

        return {
          provider: "runtime",
          id: "ok",
        };
      },
    };

    const client = createEmailClient({
      adapters: [provider],
      retry: {
        retries: 1,
        delay: () => 0,
      },
    });

    const response = await client.send(message);

    expect(response.id).toBe("ok");
    expect(attempts).toBe(2);
  });

  test("does not retry programming TypeErrors from provider transports", async () => {
    let attempts = 0;
    const provider = {
      name: "runtime",
      send() {
        attempts += 1;
        throw new TypeError("Cannot read properties of null (reading 'apiKey')");
      },
    };

    const client = createEmailClient({
      adapters: [provider],
      retry: {
        retries: 1,
        delay: () => 0,
      },
    });

    await expect(client.send(message)).rejects.toThrow("Cannot read properties");
    expect(attempts).toBe(1);
  });

  test("does not retry ENOTFOUND runtime errors", async () => {
    let attempts = 0;
    const provider = {
      name: "runtime",
      send() {
        attempts += 1;
        throw Object.assign(new Error("getaddrinfo ENOTFOUND api.example.com"), {
          code: "ENOTFOUND",
        });
      },
    };

    const client = createEmailClient({
      adapters: [provider],
      retry: {
        retries: 1,
        delay: () => 0,
      },
    });

    await expect(client.send(message)).rejects.toThrow("ENOTFOUND");
    expect(attempts).toBe(1);
  });

  test("reports the final retry attempt to onError", async () => {
    const attempts: number[] = [];
    const client = createEmailClient({
      adapters: [
        failingProvider(
          "failing",
          new EmailProviderError("Temporary failure", {
            provider: "failing",
            retryable: true,
          }),
        ),
      ],
      retry: {
        retries: 1,
        delay: () => 0,
      },
      hooks: {
        onError(event) {
          attempts.push(event.attempt);
        },
      },
    });

    await expect(client.send(message)).rejects.toBeInstanceOf(EmailProviderError);
    expect(attempts).toEqual([2]);
  });

  test("does not let hook failures mask provider errors", async () => {
    const client = createEmailClient({
      adapters: [failingProvider()],
      hooks: {
        onError() {
          throw new Error("hook failed");
        },
      },
    });

    await expect(client.send(message)).rejects.toMatchObject({
      provider: "failing",
    });
  });
});
