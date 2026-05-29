import { describe, expect, test } from "bun:test";

import { createEmailClient } from "./core.js";
import { EmailProviderError, EmailValidationError } from "./errors.js";
import { capturePlugin } from "./plugins-capture.js";
import { defaultsPlugin } from "./plugins-defaults.js";
import type { EmailPlugin, EmailProvider } from "./types.js";
import { failingProvider, memoryProvider } from "./testing.js";

const message = {
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Welcome",
  text: "Hello",
};

describe("email plugins", () => {
  test("uses a plugin adapter as the only adapter", async () => {
    const provider = memoryProvider("community");
    const client = createEmailClient({
      plugins: [adapterPlugin("community-adapter", provider)],
    });

    const response = await client.send(message);

    expect(response.provider).toBe("community");
    expect(provider.raw.sent).toHaveLength(1);
  });

  test("selects a plugin adapter as the default adapter", async () => {
    const provider = memoryProvider("community");
    const client = createEmailClient({
      adapters: [memoryProvider("primary")],
      defaultAdapter: "community",
      plugins: [adapterPlugin("community-adapter", provider)],
    });

    const response = await client.send(message);

    expect(client.defaultAdapter).toBe("community");
    expect(response.provider).toBe("community");
  });

  test("uses plugin adapters for fallback", async () => {
    const backup = memoryProvider("backup");
    const client = createEmailClient({
      adapters: [failingProvider("primary")],
      fallback: ["backup"],
      plugins: [adapterPlugin("backup-adapter", backup)],
    });

    const response = await client.send(message);

    expect(response.provider).toBe("backup");
  });

  test("rejects duplicate plugin ids", () => {
    expect(() =>
      createEmailClient({
        adapters: [memoryProvider()],
        plugins: [{ id: "same" }, { id: "same" }],
      }),
    ).toThrow(EmailValidationError);
  });

  test("rejects duplicate adapter names across direct and plugin adapters", () => {
    expect(() =>
      createEmailClient({
        adapters: [memoryProvider("same")],
        plugins: [adapterPlugin("same-plugin", memoryProvider("same"))],
      }),
    ).toThrow(EmailValidationError);
  });

  test("runs beforeSend middleware before message validation", async () => {
    const provider = memoryProvider();
    const client = createEmailClient({
      adapters: [provider],
      plugins: [
        {
          id: "defaults",
          middleware: [
            {
              beforeSend(event) {
                return {
                  message: {
                    ...event.message,
                    text: event.message.text ?? "Default body",
                    headers: {
                      "X-App": "email-sdk",
                    },
                  },
                  options: {
                    metadata: {
                      template: "welcome",
                    },
                  },
                };
              },
            },
          ],
        },
      ],
    });

    await client.send({
      from: "hello@example.com",
      to: "user@example.com",
      subject: "Welcome",
    });

    expect(provider.raw.sent[0]?.message.text).toBe("Default body");
    expect(provider.raw.sent[0]?.message.headers).toEqual({ "X-App": "email-sdk" });
  });

  test("does not swallow beforeSend middleware failures", async () => {
    const client = createEmailClient({
      adapters: [memoryProvider()],
      plugins: [
        {
          id: "policy",
          middleware: [
            {
              beforeSend() {
                throw new Error("blocked");
              },
            },
          ],
        },
      ],
    });

    await expect(client.send(message)).rejects.toThrow("blocked");
  });

  test("runs plugin hooks before user hooks", async () => {
    const order: string[] = [];
    const client = createEmailClient({
      adapters: [memoryProvider()],
      plugins: [
        {
          id: "plugin-hooks",
          hooks: {
            beforeSend() {
              order.push("plugin");
            },
          },
        },
      ],
      hooks: {
        beforeSend() {
          order.push("user");
        },
      },
    });

    await client.send(message);

    expect(order).toEqual(["plugin", "user"]);
  });

  test("does not let plugin hook failures mask provider errors", async () => {
    const client = createEmailClient({
      adapters: [failingProvider()],
      plugins: [
        {
          id: "bad-hook",
          hooks: {
            onError() {
              throw new Error("hook failed");
            },
          },
        },
      ],
    });

    await expect(client.send(message)).rejects.toMatchObject({
      provider: "failing",
    });
  });

  test("rejects client extension key collisions", () => {
    expect(() =>
      createEmailClient({
        adapters: [memoryProvider()],
        plugins: [
          {
            id: "collision",
            extendClient() {
              return { send: () => undefined };
            },
          },
        ],
      }),
    ).toThrow(EmailValidationError);
  });

  test("applies send middleware to each batch item", async () => {
    const provider = memoryProvider();
    const client = createEmailClient({
      adapters: [provider],
      plugins: [
        {
          id: "batch-defaults",
          middleware: [
            {
              beforeSend(event) {
                return {
                  message: {
                    ...event.message,
                    headers: {
                      "X-Batch": event.message.subject,
                    },
                  },
                };
              },
            },
          ],
        },
      ],
    });

    const results = await client.sendBatch([
      { ...message, subject: "First" },
      { ...message, subject: "Second" },
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(provider.raw.sent.map((item) => item.message.headers)).toEqual([
      { "X-Batch": "First" },
      { "X-Batch": "Second" },
    ]);
  });

  test("rejects async plugin adapter factories", () => {
    expect(() =>
      createEmailClient({
        plugins: [
          {
            id: "async-adapter",
            async adapters() {
              return [memoryProvider()];
            },
          },
        ],
      }),
    ).toThrow(EmailValidationError);
  });

  test("captures plugin middleware errors separately from provider errors", async () => {
    const errors: unknown[] = [];
    const client = createEmailClient({
      adapters: [
        failingProvider(
          "failing",
          new EmailProviderError("Provider failed", { provider: "failing" }),
        ),
      ],
      plugins: [
        {
          id: "capture-errors",
          middleware: [
            {
              onError(event) {
                errors.push(event.error);
              },
            },
          ],
        },
      ],
    });

    await expect(client.send(message)).rejects.toMatchObject({ provider: "failing" });
    expect(errors).toHaveLength(1);
  });

  test("built-in plugins allow custom ids", async () => {
    const provider = memoryProvider();
    const client = createEmailClient({
      adapters: [provider],
      plugins: [
        defaultsPlugin({ id: "defaults:app", headers: { "X-App": "email-sdk" } }),
        defaultsPlugin({ id: "defaults:route", tags: [{ name: "route", value: "welcome" }] }),
        capturePlugin({ id: "capture:test" }),
      ],
    });

    await client.send(message);

    expect(provider.raw.sent[0]?.message.headers).toEqual({ "X-App": "email-sdk" });
    expect(provider.raw.sent[0]?.message.tags).toEqual([{ name: "route", value: "welcome" }]);
    expect(client.capture.events).toHaveLength(2);
  });
});

function adapterPlugin(id: string, provider: EmailProvider): EmailPlugin {
  return {
    id,
    adapters: [provider],
  };
}
