import { describe, expect, test } from "bun:test";
import vm from "node:vm";

import { createEmailClient } from "./core.js";
import { EmailValidationError } from "./errors.js";
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

  test("rejects non-number maxBodyBytes in handleInbound with RangeError", async () => {
    const req = new Request("https://example.com/inbound", { method: "POST", body: "hello" });

    await expect(
      handleInbound(req, {
        provider: "resend",
        secret: "whsec_test",
        // @ts-expect-error -- untyped callers can pass a string maxBodyBytes at runtime
        maxBodyBytes: "abc",
      }),
    ).rejects.toBeInstanceOf(RangeError);
  });
});
