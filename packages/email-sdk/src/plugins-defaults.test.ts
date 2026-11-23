import { describe, expect, test } from "bun:test";

import { createEmailClient } from "./core.js";
import { defaultsPlugin } from "./plugins-defaults.js";
import { resend } from "./resend.js";
import { memoryAdapter } from "./testing.js";
import { message } from "../test-support/core-fixtures.js";
import { jsonCapture, message as legacyHeaderMessage } from "../test-support/adapter-fixtures.js";

const defaults = defaultsPlugin({
  headers: [
    { name: "X-Tenant", value: "default" },
    { name: "X-App", value: "email-sdk" },
  ],
});

describe("defaultsPlugin headers", () => {
  test("a message header replaces the same-named default, ignoring case", async () => {
    const memory = memoryAdapter();
    const client = createEmailClient({ adapters: [memory], plugins: [defaults], telemetry: false });

    await client.send({ ...message, headers: [{ name: "x-tenant", value: "acme" }] });

    expect(memory.raw.sent[0]?.message.headers).toEqual([
      { name: "X-App", value: "email-sdk" },
      { name: "x-tenant", value: "acme" },
    ]);
  });

  test("an override no longer fails validation on adapters without repeated headers", async () => {
    const capture = jsonCapture({ id: "res_1" });

    const client = createEmailClient({
      adapters: [resend({ apiKey: "re", fetch: capture.fetch })],
      plugins: [defaults],
      telemetry: false,
    });

    await client.send({ ...message, headers: [{ name: "X-Tenant", value: "acme" }] });

    expect(capture.calls[0]?.json.headers).toEqual({ "X-App": "email-sdk", "X-Tenant": "acme" });
  });

  test("defaults apply when the message sets no headers", async () => {
    const memory = memoryAdapter();
    const client = createEmailClient({ adapters: [memory], plugins: [defaults], telemetry: false });

    await client.send(message);

    expect(memory.raw.sent[0]?.message.headers).toEqual([
      { name: "X-Tenant", value: "default" },
      { name: "X-App", value: "email-sdk" },
    ]);
  });

  test("headers the message repeats on purpose are all kept", async () => {
    const memory = memoryAdapter();
    const client = createEmailClient({ adapters: [memory], plugins: [defaults], telemetry: false });

    await client.send({
      ...message,
      headers: [
        { name: "X-Tenant", value: "a" },
        { name: "X-Tenant", value: "b" },
      ],
    });

    expect(memory.raw.sent[0]?.message.headers).toEqual([
      { name: "X-App", value: "email-sdk" },
      { name: "X-Tenant", value: "a" },
      { name: "X-Tenant", value: "b" },
    ]);
  });

  test("a legacy name-to-value header object from JavaScript merges instead of throwing", async () => {
    const memory = memoryAdapter();
    const client = createEmailClient({ adapters: [memory], plugins: [defaults], telemetry: false });

    // The shared adapter fixture carries headers in the legacy { "X-Test": "yes" } object form.
    await client.send(legacyHeaderMessage);

    expect(memory.raw.sent[0]?.message.headers).toEqual([
      { name: "X-Tenant", value: "default" },
      { name: "X-App", value: "email-sdk" },
      { name: "X-Test", value: "yes" },
    ]);
  });
});

describe("defaultsPlugin sendMetadata", () => {
  test("class-instance send metadata keeps its methods and private fields", async () => {
    class RequestContext {
      readonly #tenant: string;

      constructor(tenant: string) {
        this.#tenant = tenant;
      }

      tenant() {
        return this.#tenant;
      }
    }

    const context = new RequestContext("acme");
    let seen: object | undefined;

    const client = createEmailClient({
      adapters: [
        {
          ...memoryAdapter(),
          send(_message, sendContext) {
            seen = sendContext.metadata;

            return { adapter: "memory", id: "m_1" };
          },
        },
      ],
      plugins: [defaultsPlugin({ sendMetadata: { source: "queue" } })],
      telemetry: false,
    });

    await client.send(message, { metadata: context });

    expect(seen).toBe(context);
    expect(seen instanceof RequestContext && seen.tenant()).toBe("acme");
  });

  test("plain send metadata still merges over the defaults", async () => {
    let seen: object | undefined;

    const client = createEmailClient({
      adapters: [
        {
          ...memoryAdapter(),
          send(_message, sendContext) {
            seen = sendContext.metadata;

            return { adapter: "memory", id: "m_1" };
          },
        },
      ],
      plugins: [defaultsPlugin({ sendMetadata: { source: "queue", trace: "default" } })],
      telemetry: false,
    });

    await client.send(message, { metadata: { trace: "abc" } });

    expect(seen).toEqual({ source: "queue", trace: "abc" });
  });
});
