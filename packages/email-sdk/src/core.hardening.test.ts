import { describe, expect, test } from "bun:test";
import vm from "node:vm";

import { createEmailClient } from "./core.js";
import { EmailAdapterError, EmailMiddlewareError, EmailValidationError } from "./errors.js";
import { handleInbound } from "./inbound.js";
import { decodeBase64Strict } from "./inbound/shared.js";
import {
  resetTelemetry,
  setSharedTelemetry,
  type Telemetry,
  type TelemetryEventName,
  type TelemetryProperties,
} from "./telemetry.js";
import { memoryAdapter } from "./testing.js";
import { attachmentContentToString, attachmentToBytes } from "./utils.js";

function captureTelemetry() {
  const events: Array<{ event: TelemetryEventName; properties?: TelemetryProperties }> = [];
  const exceptions: unknown[] = [];

  const telemetry: Telemetry = {
    enabled: true,
    async capture(event, properties) {
      events.push({ event, properties });
    },
    async captureException(cause) {
      exceptions.push(cause);
    },
    async flush() {},
  };

  return { telemetry, events, exceptions };
}

describe("audit hardening regressions", () => {
  test("accepts null-prototype and cross-realm messages, items, and ArrayBuffer attachments", async () => {
    const adapter = memoryAdapter("resend");
    const client = createEmailClient({ adapters: [adapter], telemetry: false });

    const nullProtoMessage = Object.assign(Object.create(null), {
      from: "a@example.com",
      to: "b@example.com",
      subject: "hi",
      text: "hello",
    });

    const sent = await client.send(nullProtoMessage);
    expect(sent.adapter).toBe("resend");

    const vmItem = vm.runInNewContext(
      '({ message: { from: "a@example.com", to: "b@example.com", subject: "hi", text: "vm" } })',
    );

    const nullProtoItem = Object.assign(Object.create(null), { message: nullProtoMessage });
    const batch = await client.sendMany([nullProtoItem, vmItem]);
    expect(batch.every((entry) => entry.ok)).toBe(true);

    const vmBuffer = vm.runInNewContext("new Uint8Array([1, 2, 3, 255]).buffer");
    expect(await attachmentContentToString(vmBuffer)).toBe("AQID/w==");
    expect([...(await attachmentToBytes({ filename: "x.bin", content: vmBuffer }))]).toEqual([
      1, 2, 3, 255,
    ]);
  });

  test("rejects malformed send, sendMany, and sendPersonalized inputs with EmailValidationError and zero exception captures", async () => {
    const { telemetry, exceptions } = captureTelemetry();
    setSharedTelemetry(telemetry);

    try {
      const client = createEmailClient({
        adapters: [memoryAdapter("resend")],
      });

      const badValues = [null, undefined, 1, []];

      for (const bad of badValues) {
        // @ts-expect-error -- untyped callers can pass malformed message values at runtime
        await expect(client.send(bad)).rejects.toBeInstanceOf(EmailValidationError);
        // @ts-expect-error -- untyped callers can pass malformed personalized inputs at runtime
        await expect(client.sendPersonalized(bad)).rejects.toBeInstanceOf(EmailValidationError);
      }

      // @ts-expect-error -- untyped callers can pass null to sendMany at runtime
      await expect(client.sendMany(null)).rejects.toBeInstanceOf(EmailValidationError);

      await expect(
        client.sendPersonalized({
          message: { from: "a@example.com", subject: "hi", text: "ok" },
          // @ts-expect-error -- untyped callers can pass non-array recipients at runtime
          recipients: 1,
        }),
      ).rejects.toBeInstanceOf(EmailValidationError);

      await expect(
        client.sendPersonalized({
          message: { from: "a@example.com", subject: "hi", text: "ok" },
          // @ts-expect-error -- untyped callers can pass null recipient entries at runtime
          recipients: [null],
        }),
      ).rejects.toBeInstanceOf(EmailValidationError);

      expect(exceptions).toHaveLength(0);
    } finally {
      resetTelemetry();
    }
  });

  test("rejects malformed base64 attachments with EmailValidationError and non-canonical decodeBase64Strict pad bits", async () => {
    await expect(
      attachmentToBytes({
        filename: "bad.bin",
        content: "not valid base64!!!",
        contentEncoding: "base64",
      }),
    ).rejects.toBeInstanceOf(EmailValidationError);

    await expect(attachmentContentToString("not valid base64!!!", "base64")).rejects.toBeInstanceOf(
      EmailValidationError,
    );

    expect(() => decodeBase64Strict("QR==")).toThrow();
    expect(() => decodeBase64Strict("QUJ=")).toThrow();
    expect([...decodeBase64Strict("AA==")]).toEqual([0]);
  });

  test("reports beforeSend rerouted adapter consistently in sendMany and sendPersonalized telemetry", async () => {
    const { telemetry, events } = captureTelemetry();
    setSharedTelemetry(telemetry);

    try {
      const resend = memoryAdapter("resend");
      const basePostmark = memoryAdapter("postmark");

      const postmark = {
        ...basePostmark,
        send: async () => {
          throw new EmailValidationError("postmark rejected scheduled send");
        },
      };

      const client = createEmailClient({
        adapters: [resend, postmark],
        plugins: [
          {
            id: "reroute-postmark-plugin",
            middleware: [
              {
                name: "reroute-postmark",
                beforeSend: (ctx) => ({
                  ...ctx,
                  options: { ...ctx.options, adapter: "postmark" },
                }),
              },
            ],
          },
        ],
      });

      const settled = await client.sendMany([
        {
          message: {
            from: "a@example.com",
            to: "b@example.com",
            subject: "hi",
            text: "later",
            sendAt: "2030-01-01T00:00:00Z",
          },
        },
      ]);

      expect(settled[0]?.ok).toBe(false);

      const sentEvent = events.find((entry) => entry.event === "email sent");
      const batchEvent = events.find((entry) => entry.event === "email batch sent");
      expect(sentEvent?.properties?.adapter).toBe("postmark");
      expect(batchEvent?.properties?.adapter).toBe("postmark");
    } finally {
      resetTelemetry();
    }
  });

  test("rejects non-number maxBodyBytes in handleInbound with RangeError including null and handshakes", async () => {
    const req = new Request("https://example.com/inbound", { method: "POST", body: "hello" });

    await expect(
      handleInbound(req, {
        provider: "resend",
        secret: "whsec_test",
        // @ts-expect-error -- untyped callers can pass a string maxBodyBytes at runtime
        maxBodyBytes: "abc",
      }),
    ).rejects.toBeInstanceOf(RangeError);

    await expect(
      handleInbound(req, {
        provider: "resend",
        secret: "whsec_test",
        // @ts-expect-error -- untyped callers can pass null maxBodyBytes at runtime
        maxBodyBytes: null,
      }),
    ).rejects.toBeInstanceOf(RangeError);

    const graphHandshake = new Request("https://example.com/inbound?validationToken=ok", {
      method: "POST",
    });

    await expect(
      handleInbound(graphHandshake, {
        provider: "graph",
        clientState: "state",
        api: { getAccessToken: () => "token" },
        maxBodyBytes: 0,
      }),
    ).rejects.toBeInstanceOf(RangeError);

    const mailchimpHead = new Request("https://example.com/inbound", { method: "HEAD" });

    await expect(
      handleInbound(mailchimpHead, {
        provider: "mailchimp",
        secret: "key",
        url: "https://example.com/inbound",
        maxBodyBytes: -1,
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  test("rejects invalid attachment content, non-canonical base64 padding, and supports DataView/SharedArrayBuffer", async () => {
    const invalidContents = [5, {}, [], null, true];

    for (const content of invalidContents) {
      await expect(
        // @ts-expect-error -- untyped callers can pass non-binary attachment content at runtime
        attachmentContentToString(content),
      ).rejects.toBeInstanceOf(EmailValidationError);

      await expect(
        attachmentToBytes({
          filename: "bad.bin",
          // @ts-expect-error -- untyped callers can pass non-binary attachment content at runtime
          content,
        }),
      ).rejects.toBeInstanceOf(EmailValidationError);
    }

    const badBase64 = ["====", "=", "QUJD===", "YQ=====", "QR==", "QUJ="];

    for (const content of badBase64) {
      await expect(attachmentContentToString(content, "base64")).rejects.toBeInstanceOf(
        EmailValidationError,
      );

      await expect(
        attachmentToBytes({
          filename: "bad.bin",
          content,
          contentEncoding: "base64",
        }),
      ).rejects.toBeInstanceOf(EmailValidationError);
    }

    // URL-safe base64 without padding is canonicalized to standard padded base64.
    expect(await attachmentContentToString("-_8", "base64")).toBe("+/8=");

    const view = new DataView(new Uint8Array([9, 10, 11, 12]).buffer, 1, 2);
    expect(await attachmentContentToString(view)).toBe("Cgs=");
    expect([...(await attachmentToBytes({ filename: "dv.bin", content: view }))]).toEqual([10, 11]);

    const shared = new SharedArrayBuffer(3);
    new Uint8Array(shared).set([1, 2, 3]);
    expect(await attachmentContentToString(shared)).toBe("AQID");
    expect([...(await attachmentToBytes({ filename: "sab.bin", content: shared }))]).toEqual([
      1, 2, 3,
    ]);
  });

  test("rejects malformed send, sendPersonalized, and idempotencyKey fields with EmailValidationError and zero exception captures", async () => {
    const { telemetry, exceptions } = captureTelemetry();
    setSharedTelemetry(telemetry);

    try {
      const client = createEmailClient({
        adapters: [memoryAdapter("resend")],
      });

      await expect(
        client.send({
          from: "a@example.com",
          to: "b@example.com",
          // @ts-expect-error -- untyped callers can pass numeric subject at runtime
          subject: 123,
          text: "ok",
        }),
      ).rejects.toBeInstanceOf(EmailValidationError);

      await expect(
        client.send({
          from: "a@example.com",
          to: "b@example.com",
          subject: "ok",
          text: "ok",
          attachments: [
            {
              filename: "bad.bin",
              // @ts-expect-error -- untyped callers can pass null attachment content at runtime
              content: null,
            },
          ],
        }),
      ).rejects.toBeInstanceOf(EmailValidationError);

      await expect(
        client.send(
          { from: "a@example.com", to: "b@example.com", subject: "ok", text: "ok" },
          { idempotencyKey: "" },
        ),
      ).rejects.toBeInstanceOf(EmailValidationError);

      await expect(
        client.send(
          { from: "a@example.com", to: "b@example.com", subject: "ok", text: "ok" },
          // @ts-expect-error -- untyped callers can pass numeric idempotencyKey at runtime
          { idempotencyKey: 0 },
        ),
      ).rejects.toBeInstanceOf(EmailValidationError);

      await expect(
        client.sendPersonalized({
          message: { from: "a@example.com", subject: "hi", text: "ok" },
          // @ts-expect-error -- untyped callers can pass null recipient.to at runtime
          recipients: [{ to: null }],
        }),
      ).rejects.toBeInstanceOf(EmailValidationError);

      await expect(
        client.sendPersonalized({
          message: { from: "a@example.com", subject: "hi %recipient.x%", text: "ok" },
          recipients: [
            {
              to: "b@example.com",
              // @ts-expect-error -- untyped callers can pass null-prototype objects without toString
              variables: { x: Object.create(null) },
            },
          ],
        }),
      ).rejects.toBeInstanceOf(EmailValidationError);

      const okPersonalized = await client.sendPersonalized({
        message: { from: "a@example.com", subject: "hi %recipient.x%", text: "body" },
        // @ts-expect-error -- untyped callers can omit variables
        recipients: [{ to: "b@example.com", variables: undefined }],
      });

      expect(okPersonalized.accepted).toHaveLength(1);
      expect(exceptions).toHaveLength(0);
    } finally {
      resetTelemetry();
    }
  });

  test("preserves rerouted adapter on later middleware throw and fallback adapter on middleware throw", async () => {
    const { telemetry, events } = captureTelemetry();
    setSharedTelemetry(telemetry);

    try {
      const resend = {
        ...memoryAdapter("resend"),
        send: async () => {
          throw new EmailAdapterError("primary rejected", {
            adapter: "resend",
            delivery: "not_sent",
          });
        },
      };

      const postmark = memoryAdapter("postmark");

      const rerouteThenThrowClient = createEmailClient({
        adapters: [memoryAdapter("resend"), postmark],
        plugins: [
          {
            id: "two-step",
            middleware: [
              {
                name: "reroute",
                beforeSend: (ctx) => ({
                  ...ctx,
                  options: { ...ctx.options, adapter: "postmark" },
                }),
              },
              {
                name: "throw-after-reroute",
                beforeSend: () => {
                  throw new Error("stop");
                },
              },
            ],
          },
        ],
      });

      await expect(
        rerouteThenThrowClient.send({
          from: "a@example.com",
          to: "b@example.com",
          subject: "hi",
          text: "body",
        }),
      ).rejects.toBeInstanceOf(EmailMiddlewareError);

      expect(events.at(-1)?.properties?.adapter).toBe("postmark");

      const fallbackClient = createEmailClient({
        adapters: [resend, postmark],
        fallback: { adapters: ["postmark"] },
        plugins: [
          {
            id: "after-throw",
            middleware: [
              {
                name: "after-send-throw",
                afterSend: () => {
                  throw new Error("afterSend failed");
                },
              },
            ],
          },
        ],
      });

      await expect(
        fallbackClient.send({
          from: "a@example.com",
          to: "b@example.com",
          subject: "hi",
          text: "body",
        }),
      ).rejects.toBeInstanceOf(EmailMiddlewareError);

      expect(events.at(-1)?.properties?.adapter).toBe("postmark");
    } finally {
      resetTelemetry();
    }
  });

  test("derives distinct per-item idempotency keys in sendMany and settles throwing item getters", async () => {
    const seenKeys: Array<string | undefined> = [];
    const base = memoryAdapter("resend");

    const adapter = {
      ...base,
      send: async (message: Parameters<typeof base.send>[0], ctx: Parameters<typeof base.send>[1]) => {
        seenKeys.push(ctx.idempotencyKey);

        return base.send(message, ctx);
      },
    };

    const client = createEmailClient({ adapters: [adapter], telemetry: false });

    const throwingItem = {};

    Object.defineProperty(throwingItem, "message", {
      enumerable: true,
      get() {
        throw new Error("getter exploded");
      },
    });

    const settled = await client.sendMany(
      [
        {
          message: { from: "a@example.com", to: "one@example.com", subject: "1", text: "one" },
        },
        // @ts-expect-error -- testing runtime item with throwing getter
        throwingItem,
        {
          message: { from: "a@example.com", to: "two@example.com", subject: "2", text: "two" },
        },
        {
          message: { from: "a@example.com", to: "three@example.com", subject: "3", text: "three" },
          options: { idempotencyKey: "custom-key" },
        },
      ],
      { idempotencyKey: "batch-key" },
    );

    expect(settled[0]?.ok).toBe(true);
    expect(settled[1]?.ok).toBe(false);
    expect(settled[2]?.ok).toBe(true);
    expect(settled[3]?.ok).toBe(true);
    expect(seenKeys).toEqual(["batch-key:0", "batch-key:2", "custom-key"]);
  });

  test("rejects whitespace shared keys, preserves invalid shared keys over undefined item key, rejects spoofed buffers, tracks in-place reroutes, and handles throwing getters safely", async () => {
    const { telemetry, events, exceptions } = captureTelemetry();
    setSharedTelemetry(telemetry);

    try {
      const resend = memoryAdapter("resend");
      const postmark = memoryAdapter("postmark");
      const client = createEmailClient({ adapters: [resend, postmark] });
      const msg = { from: "a@example.com", to: "b@example.com", subject: "hi", text: "ok" };

      const wsBatch = await client.sendMany([{ message: msg }], { idempotencyKey: "   " });
      expect(wsBatch[0]?.ok).toBe(false);

      if (!wsBatch[0]?.ok) expect(wsBatch[0]?.error).toBeInstanceOf(EmailValidationError);

      const overrideUndef = await client.sendMany(
        [{ message: msg, options: { idempotencyKey: undefined } }],
        { idempotencyKey: "" },
      );

      expect(overrideUndef[0]?.ok).toBe(false);

      if (!overrideUndef[0]?.ok) {
        expect(overrideUndef[0]?.error).toBeInstanceOf(EmailValidationError);
      }

      // Spoofed Symbol.toStringTag ArrayBuffer/Date rejected
      const fakeBuffer = { [Symbol.toStringTag]: "ArrayBuffer" };

      await expect(
        client.send({
          ...msg,
          // @ts-expect-error -- runtime spoof check
          attachments: [{ filename: Object.create(null), content: fakeBuffer }],
        }),
      ).rejects.toBeInstanceOf(EmailValidationError);

      // Cross-realm Blob-like object accepted
      const blobLike = {
        [Symbol.toStringTag]: "Blob",
        async arrayBuffer() {
          return new Uint8Array([65, 66]).buffer;
        },
      };

      // @ts-expect-error -- simulating cross-realm Blob
      expect(await attachmentContentToString(blobLike)).toBe("QUI=");

      // Throwing item.options getter settles as EmailValidationError with accurate batch adapter
      const badOptsItem = { message: msg };

      Object.defineProperty(badOptsItem, "options", {
        enumerable: true,
        get() {
          throw new TypeError("options boom");
        },
      });

      // @ts-expect-error -- runtime throwing getter check
      const badOptsRes = await client.sendMany([badOptsItem]);
      expect(badOptsRes[0]?.ok).toBe(false);

      if (!badOptsRes[0]?.ok) expect(badOptsRes[0]?.error).toBeInstanceOf(EmailValidationError);

      // In-place options.adapter mutation + later throw preserves rerouted adapter
      const inPlaceClient = createEmailClient({
        adapters: [resend, postmark],
        plugins: [
          {
            id: "in-place-reroute",
            middleware: [
              {
                name: "mutate",
                beforeSend: (ctx) => {
                  if (ctx.options) ctx.options.adapter = "postmark";
                },
              },
              {
                name: "fail",
                beforeSend: () => {
                  throw new Error("stop");
                },
              },
            ],
          },
        ],
      });

      await expect(inPlaceClient.send(msg, { adapter: "resend" })).rejects.toBeInstanceOf(
        EmailMiddlewareError,
      );

      expect(events.at(-1)?.properties?.adapter).toBe("postmark");
      expect(exceptions).toHaveLength(0);
    } finally {
      resetTelemetry();
    }
  });

  test("deeply isolates metadata and fallback options across send, sendMany, and plugins; hardens createEmailClient and SMTP Blob/binary attachments", async () => {
    const { smtp } = await import("./smtp.js");
    const { defaultsPlugin } = await import("./plugins-defaults.js");
    const { telemetry, exceptions } = captureTelemetry();
    setSharedTelemetry(telemetry);

    try {
      // 1. Recursive metadata + fallback.adapters isolation on send() and sendMany()
      const observedAttempts: number[] = [];
      const resend = memoryAdapter("resend");
      const postmark = memoryAdapter("postmark");

      const mutatingClient = createEmailClient({
        adapters: [resend, postmark],
        plugins: [
          {
            id: "mutator",
            middleware: [
              {
                name: "mutate-options",
                beforeSend: (ctx) => {
                  // SAFETY: Test fixture passes metadata.trace as { attempts: number }.
                  const trace = ctx.options?.metadata?.trace as { attempts: number } | undefined;

                  if (trace) {
                    observedAttempts.push(trace.attempts);
                    trace.attempts += 1;
                  }

                  // SAFETY: Test fixture passes fallback.adapters as a mutable string array.
                  const adapters = ctx.options?.fallback?.adapters as string[] | undefined;

                  if (Array.isArray(adapters)) adapters.push("postmark");
                },
              },
            ],
          },
        ],
      });

      const sharedOpts = {
        metadata: { trace: { attempts: 0 }, tags: ["a"] },
        fallback: { adapters: ["postmark" as const] },
      };

      const msg = { from: "a@example.com", to: "b@example.com", subject: "hi", text: "ok" };

      await mutatingClient.send(msg, sharedOpts);
      await mutatingClient.send(msg, sharedOpts);

      expect(sharedOpts.metadata.trace.attempts).toBe(0);
      expect(sharedOpts.fallback.adapters).toEqual(["postmark"]);

      observedAttempts.length = 0;

      const batchResults = await mutatingClient.sendMany(
        [{ message: msg }, { message: msg }],
        sharedOpts,
      );

      expect(batchResults.every((r) => r.ok)).toBe(true);
      expect(observedAttempts).toEqual([0, 0]);
      expect(sharedOpts.metadata.trace.attempts).toBe(0);

      // 2. defaultsPlugin returns fresh headers/tags arrays so middleware mutations do not compound
      const seenHeaders: Array<number> = [];

      const defaultsClient = createEmailClient({
        adapters: [
          {
            ...memoryAdapter("resend"),
            send: async (message, ctx) => {
              seenHeaders.push(Array.isArray(message.headers) ? message.headers.length : 0);

              return memoryAdapter("resend").send(message, ctx);
            },
          },
        ],
        plugins: [
          defaultsPlugin({
            headers: [{ name: "X-Default", value: "1" }],
            tags: [{ name: "env", value: "test" }],
          }),
          {
            id: "push-header",
            middleware: [
              {
                name: "push",
                beforeSend: (ctx) => {
                  if (Array.isArray(ctx.message.headers)) {
                    ctx.message.headers.push({ name: "X-Extra", value: "mut" });
                  }
                },
              },
            ],
          },
        ],
      });

      await defaultsClient.send(msg);
      await defaultsClient.send(msg);
      expect(seenHeaders).toEqual([2, 2]);

      // 3. createEmailClient catches throwing getters, null adapters/plugins, and snapshots fallback/retry
      expect(() =>
        createEmailClient({
          // @ts-expect-error -- runtime null adapter
          adapters: [null],
        }),
      ).toThrow(EmailValidationError);

      expect(() =>
        createEmailClient({
          adapters: [resend],
          // @ts-expect-error -- runtime null plugin
          plugins: [null],
        }),
      ).toThrow(EmailValidationError);

      const throwingOpts = {};

      Object.defineProperty(throwingOpts, "adapters", {
        enumerable: true,
        get() {
          throw new TypeError("adapters boom");
        },
      });

      // @ts-expect-error -- runtime throwing getter
      expect(() => createEmailClient(throwingOpts)).toThrow(EmailValidationError);

      const throwingFallback = Object.defineProperty(
        { adapters: ["postmark" as const] },
        "onUnknownDelivery",
        {
          enumerable: true,
          get() {
            throw new TypeError("onUnknownDelivery boom");
          },
        },
      );

      expect(() =>
        createEmailClient({
          adapters: [resend, postmark],
          fallback: throwingFallback,
        }),
      ).toThrow(EmailValidationError);

      const throwingRetry = Object.defineProperty({ maxAttempts: 2 }, "shouldRetry", {
        enumerable: true,
        get() {
          throw new TypeError("shouldRetry boom");
        },
      });

      expect(() =>
        createEmailClient({
          adapters: [resend],
          retry: throwingRetry,
        }),
      ).toThrow(EmailValidationError);

      // 4. SMTP rejecting Blob.arrayBuffer() yields EmailValidationError and zero exception captures
      const badBlob = new Blob(["x"]);

      badBlob.arrayBuffer = () => Promise.reject(new TypeError("blob read failed"));

      const smtpClient = createEmailClient({
        adapters: [smtp({ host: "127.0.0.1", port: 1 })],
      });

      await expect(
        smtpClient.send({
          ...msg,
          attachments: [{ filename: "bad.bin", content: badBlob }],
        }),
      ).rejects.toBeInstanceOf(EmailValidationError);

      expect(exceptions).toHaveLength(0);
    } finally {
      resetTelemetry();
    }
  });

  test("hardens cross-realm metadata, class-instance retry/hooks, defaultsPlugin nested fields, SMTP base64 validation, telemetry-enabled personalized-only adapters, and createEmailClient boundaries", async () => {
    const vm = await import("node:vm");
    const { smtp } = await import("./smtp.js");
    const { defaultsPlugin } = await import("./plugins-defaults.js");
    const { telemetry, exceptions } = captureTelemetry();
    setSharedTelemetry(telemetry);

    try {
      const resend = memoryAdapter("resend");
      const postmark = memoryAdapter("postmark");
      const msg = { from: "a@example.com", to: "b@example.com", subject: "hi", text: "ok" };

      // 1. Cross-realm plain objects in metadata are deeply cloned
      const crossRealm = vm.runInNewContext('({ trace: { count: 0 }, tags: ["a"] })');
      const seenCounts: number[] = [];

      const realmClient = createEmailClient({
        adapters: [resend],
        plugins: [
          {
            id: "realm-mutator",
            middleware: [
              {
                name: "mutate-meta",
                beforeSend: (ctx) => {
                  // SAFETY: Cross-realm fixture has shape { trace: { count: number } }.
                  const trace = ctx.options?.metadata?.trace as { count: number } | undefined;

                  if (trace) {
                    seenCounts.push(trace.count);
                    trace.count += 1;
                  }
                },
              },
            ],
          },
        ],
      });

      await realmClient.send(msg, { metadata: crossRealm });
      await realmClient.send(msg, { metadata: crossRealm });
      expect(seenCounts).toEqual([0, 0]);
      expect(crossRealm.trace.count).toBe(0);

      // 2. Class-instance retry and hooks preserve prototype methods with bound `this`
      class CustomRetry {
        maxAttempts = 2;
        checked = 0;
        shouldRetry() {
          this.checked += 1;

          return true;
        }
        delay() {
          return 0;
        }
      }

      class CustomHooks {
        before = 0;
        after = 0;
        beforeSend() {
          this.before += 1;
        }
        afterSend() {
          this.after += 1;
        }
      }

      let attempts = 0;
      const flakyRetry = new CustomRetry();
      const classHooks = new CustomHooks();

      const classClient = createEmailClient({
        adapters: [
          {
            ...resend,
            send: async (message, ctx) => {
              attempts += 1;

              if (attempts === 1) {
                throw new EmailAdapterError("transient", {
                  adapter: "resend",
                  retryable: true,
                  delivery: "not_sent",
                });
              }

              return resend.send(message, ctx);
            },
          },
        ],
        retry: flakyRetry,
        hooks: classHooks,
      });

      await classClient.send(msg);
      expect(attempts).toBe(2);
      expect(flakyRetry.checked).toBe(1);
      expect(classHooks.before).toBe(2);
      expect(classHooks.after).toBe(1);

      // 3. Invalid retry/fallback callbacks and enum values throw EmailValidationError up front
      expect(() =>
        createEmailClient({
          adapters: [resend],
          // @ts-expect-error -- runtime invalid shouldRetry
          retry: { maxAttempts: 2, shouldRetry: 5 },
        }),
      ).toThrow(EmailValidationError);

      expect(() =>
        createEmailClient({
          adapters: [resend, postmark],
          // @ts-expect-error -- runtime invalid onUnknownDelivery
          fallback: { adapters: ["postmark"], onUnknownDelivery: "maybe" },
        }),
      ).toThrow(EmailValidationError);

      // 4. Throwing hooks.beforeSend getter, throwing plugin.middleware getter, and single-read plugins with telemetry on
      const badHooks = {};

      Object.defineProperty(badHooks, "beforeSend", {
        enumerable: true,
        get() {
          throw new TypeError("hook getter boom");
        },
      });

      expect(() =>
        createEmailClient({
          adapters: [resend],
          hooks: badHooks,
        }),
      ).toThrow(EmailValidationError);

      const badPlugin = { id: "bad-mw" };

      Object.defineProperty(badPlugin, "middleware", {
        enumerable: true,
        get() {
          throw new TypeError("middleware getter boom");
        },
      });

      expect(() =>
        createEmailClient({
          adapters: [resend],
          plugins: [badPlugin],
        }),
      ).toThrow(EmailValidationError);

      let pluginReads = 0;
      const singleReadOpts = { adapters: [resend] };

      Object.defineProperty(singleReadOpts, "plugins", {
        enumerable: true,
        get() {
          pluginReads += 1;

          return [];
        },
      });

      createEmailClient(singleReadOpts);
      expect(pluginReads).toBe(1);

      // 5. defaultsPlugin deeply isolates replyTo and sendMetadata across sends
      const seenReplyTo: string[] = [];
      const seenMeta: number[] = [];

      const defaultsClient = createEmailClient({
        adapters: [
          {
            ...resend,
            send: async (message, ctx) => {
              const firstReply = Array.isArray(message.replyTo)
                ? message.replyTo[0]
                : message.replyTo;

              seenReplyTo.push(
                firstReply instanceof Object ? firstReply.email : (firstReply ?? ""),
              );

              return resend.send(message, ctx);
            },
          },
        ],
        plugins: [
          defaultsPlugin({
            replyTo: [{ email: "reply@example.com", name: "Reply" }],
            sendMetadata: { nested: { count: 0 } },
          }),
          {
            id: "mutate-defaults",
            middleware: [
              {
                name: "mutate",
                beforeSend: (ctx) => {
                  if (Array.isArray(ctx.message.replyTo) && ctx.message.replyTo[0]) {
                    // SAFETY: Test fixture sets replyTo as an array of EmailAddress objects.
                    const addr = ctx.message.replyTo[0] as { email: string };
                    addr.email = "mutated@example.com";
                  }

                  // SAFETY: Test fixture passes sendMetadata.nested as { count: number }.
                  const nested = ctx.options?.metadata?.nested as { count: number } | undefined;

                  if (nested) {
                    seenMeta.push(nested.count);
                    nested.count += 1;
                  }
                },
              },
            ],
          },
        ],
      });

      await defaultsClient.send(msg);
      await defaultsClient.send(msg);
      expect(seenReplyTo).toEqual(["mutated@example.com", "mutated@example.com"]);
      expect(seenMeta).toEqual([0, 0]);

      // 6. Personalized-only adapter works with telemetry enabled (no `in undefined` crash in isTestAdapter)
      const personalizedOnly: EmailAdapter<"custom-pers"> = {
        name: "custom-pers",
        capabilities: {
          attachments: false,
          inlineAttachments: false,
          scheduling: false,
          tags: false,
          customHeaders: false,
          repeatedHeaders: false,
          idempotency: "none",
          personalized: "native",
          templates: false,
        },
        // SAFETY: Test fixture exercises a personalized-only adapter with no send() method.
        send: undefined as never,
        sendPersonalized: async (input) => ({
          id: "pers-1",
          adapter: "custom-pers",
          accepted: input.recipients.map((r) => (r.to instanceof Object ? r.to.email : r.to)),
          rejected: [],
          results: input.recipients.map((r) => ({
            to: r.to instanceof Object ? r.to.email : r.to,
            ok: true as const,
            id: "pers-1",
          })),
        }),
      };

      const persClient = createEmailClient({ adapters: [personalizedOnly] });

      const persResult = await persClient.sendPersonalized({
        message: {
          from: "a@example.com",
          subject: "hi",
          text: "hello",
        },
        recipients: [{ to: "b@example.com" }],
      });

      expect(persResult.accepted).toEqual(["b@example.com"]);

      // 7. SMTP rejects invalid base64 string attachments with EmailValidationError before connecting
      const smtpClient = createEmailClient({
        adapters: [smtp({ host: "127.0.0.1", port: 1 })],
      });

      await expect(
        smtpClient.send({
          ...msg,
          attachments: [{ filename: "bad.bin", content: "QR==", contentEncoding: "base64" }],
        }),
      ).rejects.toBeInstanceOf(EmailValidationError);

      expect(exceptions).toHaveLength(0);
    } finally {
      resetTelemetry();
    }
  });
});
