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
});
