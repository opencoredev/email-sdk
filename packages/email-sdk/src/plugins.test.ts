import { describe, expect, test } from "bun:test";

import { createEmailClient } from "./core.js";
import {
  EmailAdapterError,
  EmailMiddlewareError,
  EmailRouteError,
  EmailValidationError,
} from "./errors.js";
import { capturePlugin } from "./plugins-capture.js";
import { defaultsPlugin } from "./plugins-defaults.js";
import { observabilityPlugin } from "./plugins-observability.js";
import { routingPlugin } from "./plugins-routing.js";
import { timeoutPlugin } from "./plugins-timeout.js";
import type { EmailAdapter, EmailPlugin } from "./types.js";
import { failingAdapter, memoryAdapter } from "./testing.js";

const message = {
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Welcome",
  text: "Hello",
};

describe("email plugins", () => {
  test("uses a plugin adapter as the only adapter", async () => {
    const provider = memoryAdapter("community");
    const client = createEmailClient({
      plugins: [adapterPlugin("community-adapter", provider)],
    });

    const response = await client.send(message);

    expect(response.adapter).toBe("community");
    expect(provider.raw.sent).toHaveLength(1);
  });

  test("selects a plugin adapter as the default adapter", async () => {
    const provider = memoryAdapter("community");
    const client = createEmailClient({
      adapters: [memoryAdapter("primary")],
      defaultAdapter: "community",
      plugins: [adapterPlugin("community-adapter", provider)],
    });

    const response = await client.send(message);

    expect(client.defaultAdapter).toBe("community");
    expect(response.adapter).toBe("community");
  });

  test("uses plugin adapters for fallback", async () => {
    const backup = memoryAdapter("backup");
    const client = createEmailClient({
      adapters: [
        failingAdapter(
          "primary",
          new EmailAdapterError("not sent", {
            adapter: "primary",
            delivery: "not_sent",
          }),
        ),
      ],
      fallback: { adapters: ["backup"] },
      plugins: [adapterPlugin("backup-adapter", backup)],
    });

    const response = await client.send(message);

    expect(response.adapter).toBe("backup");
  });

  test("rejects duplicate plugin ids", () => {
    expect(() =>
      createEmailClient({
        adapters: [memoryAdapter()],
        plugins: [{ id: "same" }, { id: "same" }],
      }),
    ).toThrow(EmailValidationError);
  });

  test("rejects duplicate adapter names across direct and plugin adapters", () => {
    expect(() =>
      createEmailClient({
        adapters: [memoryAdapter("same")],
        plugins: [adapterPlugin("same-plugin", memoryAdapter("same"))],
      }),
    ).toThrow(EmailValidationError);
  });

  test("runs beforeSend middleware before message validation", async () => {
    const provider = memoryAdapter();
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
                    headers: [{ name: "X-App", value: "email-sdk" }],
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
    expect(provider.raw.sent[0]?.message.headers).toEqual([{ name: "X-App", value: "email-sdk" }]);
  });

  test("does not swallow beforeSend middleware failures", async () => {
    const client = createEmailClient({
      adapters: [memoryAdapter()],
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

    await expect(client.send(message)).rejects.toBeInstanceOf(EmailMiddlewareError);
  });

  test("runs plugin hooks before user hooks", async () => {
    const order: string[] = [];
    const client = createEmailClient({
      adapters: [memoryAdapter()],
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
      adapters: [failingAdapter()],
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

    const error = await client.send(message).catch((caught) => caught);
    expect(error).toBeInstanceOf(EmailRouteError);
    expect((error as EmailRouteError).failures[0]?.adapter).toBe("failing");
  });

  test("rejects client extension key collisions", () => {
    expect(() =>
      createEmailClient({
        adapters: [memoryAdapter()],
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

  test("allows client extension keys from Object.prototype", () => {
    const client = createEmailClient({
      adapters: [memoryAdapter()],
      plugins: [
        {
          id: "to-string",
          extendClient() {
            return {
              toString() {
                return "email-client";
              },
            };
          },
        },
      ],
    });

    expect(client.toString()).toBe("email-client");
  });

  test("applies send middleware to each batch item", async () => {
    const provider = memoryAdapter();
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
                    headers: [{ name: "X-Batch", value: event.message.subject }],
                  },
                };
              },
            },
          ],
        },
      ],
    });

    const results = await client.sendMany([
      { message: { ...message, subject: "First" } },
      { message: { ...message, subject: "Second" } },
    ]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(provider.raw.sent.map((item) => item.message.headers)).toEqual([
      [{ name: "X-Batch", value: "First" }],
      [{ name: "X-Batch", value: "Second" }],
    ]);
  });

  test("rejects async plugin adapter factories", () => {
    expect(() =>
      createEmailClient({
        plugins: [
          {
            id: "async-adapter",
            async adapters() {
              return [memoryAdapter()];
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
        failingAdapter(
          "failing",
          new EmailAdapterError("Adapter failed", {
            adapter: "failing",
            delivery: "not_sent",
          }),
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

    await expect(client.send(message)).rejects.toBeInstanceOf(EmailRouteError);
    expect(errors).toHaveLength(1);
  });

  test("does not double-register adapters added and returned by a plugin factory", async () => {
    const provider = memoryAdapter("factory");
    const client = createEmailClient({
      plugins: [
        {
          id: "factory-adapter",
          adapters(ctx) {
            ctx.addAdapter(provider);
            return [provider];
          },
        },
      ],
    });

    const response = await client.send(message);

    expect(response.adapter).toBe("factory");
  });

  test("built-in plugins allow custom ids", async () => {
    const provider = memoryAdapter();
    const client = createEmailClient({
      adapters: [provider],
      plugins: [
        defaultsPlugin({
          id: "defaults:app",
          headers: [{ name: "X-App", value: "email-sdk" }],
        }),
        defaultsPlugin({ id: "defaults:route", tags: [{ name: "route", value: "welcome" }] }),
        capturePlugin({ id: "capture:test" }),
      ],
    });

    await client.send(message);

    expect(provider.raw.sent[0]?.message.headers).toEqual([{ name: "X-App", value: "email-sdk" }]);
    expect(provider.raw.sent[0]?.message.tags).toEqual([{ name: "route", value: "welcome" }]);
    expect(client.capture.events).toHaveLength(2);
  });

  test("capture plugins can use custom client extension keys", async () => {
    const client = createEmailClient({
      adapters: [memoryAdapter()],
      plugins: [
        capturePlugin({ id: "capture:primary", clientKey: "primaryCapture" }),
        capturePlugin({ id: "capture:audit", clientKey: "auditCapture" }),
      ],
    });

    await client.send(message);

    expect(client.primaryCapture.events).toHaveLength(2);
    expect(client.auditCapture.events).toHaveLength(2);
  });

  test("observability callbacks run independently when one callback fails", async () => {
    const events: string[] = [];
    const client = createEmailClient({
      adapters: [memoryAdapter()],
      plugins: [
        observabilityPlugin({
          log() {
            throw new Error("logger down");
          },
          metric(event) {
            events.push(`metric:${event.type}`);
          },
          trace(event) {
            events.push(`trace:${event.type}`);
          },
        }),
      ],
    });

    await client.send(message);

    expect(events).toEqual(["metric:email.sent", "trace:email.sent"]);
  });

  test("routing plugin selects an adapter from the prepared message", async () => {
    const primary = memoryAdapter("primary");
    const transactional = memoryAdapter("transactional");
    const client = createEmailClient({
      adapters: [primary, transactional],
      plugins: [
        routingPlugin({
          select(event) {
            return event.message.subject.startsWith("Receipt") ? "transactional" : undefined;
          },
        }),
      ],
    });

    const selected = await client.send({ ...message, subject: "Receipt 123" });
    const defaulted = await client.send(message);

    expect(selected.adapter).toBe("transactional");
    expect(defaulted.adapter).toBe("primary");
    expect(transactional.raw.sent).toHaveLength(1);
    expect(primary.raw.sent).toHaveLength(1);
  });

  test("timeout plugin composes with caller cancellation", async () => {
    const caller = new AbortController();
    let preparedSignal: AbortSignal | undefined;
    const client = createEmailClient({
      adapters: [memoryAdapter()],
      plugins: [
        timeoutPlugin({ timeoutMs: 20 }),
        {
          id: "inspect-signal",
          middleware: [
            {
              beforeSend(event) {
                preparedSignal = event.options?.signal;
              },
            },
          ],
        },
      ],
    });

    await client.send(message, { signal: caller.signal });
    expect(preparedSignal?.aborted).toBe(false);
    caller.abort();
    expect(preparedSignal?.aborted).toBe(true);
  });

  test("timeout plugin rejects invalid durations", () => {
    expect(() => timeoutPlugin({ timeoutMs: 0 })).toThrow(EmailValidationError);
  });

  test("built-in and community plugins participate in personalized expanded sends", async () => {
    const provider = memoryAdapter("community");
    const observed: string[] = [];
    const client = createEmailClient({
      plugins: [
        adapterPlugin("community-adapter", provider),
        defaultsPlugin({
          headers: [{ name: "X-App", value: "email-sdk" }],
          sendMetadata: { campaign: "welcome" },
          idempotencyKeyPrefix: "mail:",
          idempotencyKey: "campaign",
        }),
        capturePlugin({ id: "capture:personalized" }),
        observabilityPlugin({
          metric(event) {
            observed.push(`${event.type}:${event.adapter}:${event.metadata?.campaign ?? "none"}`);
          },
        }),
      ],
    });

    const result = await client.sendPersonalized({
      message: { from: message.from, subject: "Hi %recipient.name%", text: "Hello %recipient.name%" },
      recipients: [
        { to: "ada@example.com", variables: { name: "Ada" } },
        { to: "linus@example.com", variables: { name: "Linus" } },
      ],
    });

    expect(result.accepted).toEqual(["ada@example.com", "linus@example.com"]);
    expect(provider.raw.sent.map((item) => item.message.subject)).toEqual(["Hi Ada", "Hi Linus"]);
    expect(provider.raw.sent.map((item) => item.message.headers)).toEqual([
      [{ name: "X-App", value: "email-sdk" }],
      [{ name: "X-App", value: "email-sdk" }],
    ]);
    expect(client.capture.events.map((event) => event.type)).toEqual([
      "beforeSend",
      "afterSend",
      "afterSend",
    ]);
    expect(observed).toEqual([
      "email.sent:community:welcome",
      "email.sent:community:welcome",
    ]);
  });
});

function adapterPlugin(id: string, provider: EmailAdapter): EmailPlugin {
  return {
    id,
    adapters: [provider],
  };
}
