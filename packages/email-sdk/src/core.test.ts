import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createEmailClient } from "./core.js";
import { resend } from "./resend.js";
import { failingAdapter, memoryAdapter } from "./testing.js";
import {
  EmailAbortError,
  EmailAdapterError,
  EmailAllRecipientsFailedError,
  EmailMiddlewareError,
  EmailRouteError,
  EmailValidationError,
} from "./errors.js";
import type { EmailAdapter, EmailMessage } from "./types.js";
import type { Telemetry, TelemetryEventName, TelemetryProperties } from "./telemetry.js";
import { createTelemetry, resetTelemetry, setSharedTelemetry } from "./telemetry.js";

const message: EmailMessage = {
  from: "hello@example.com",
  to: "user@example.com",
  subject: "Hello",
  text: "Hello there",
};

const capabilities = {
  repeatedHeaders: true,
  idempotency: "native" as const,
  scheduling: true,
  personalized: "expanded" as const,
};

function adapter<const Name extends string>(
  name: Name,
  send: EmailAdapter<Name>["send"] = () => ({ adapter: name, id: `${name}_1` }),
  overrides: Partial<EmailAdapter<Name>> = {},
): EmailAdapter<Name> {
  return { name, capabilities, send, ...overrides };
}

function telemetryCapture() {
  const events: Array<{ event: TelemetryEventName; properties?: TelemetryProperties }> = [];
  const exceptions: unknown[] = [];
  const telemetry: Telemetry = {
    enabled: true,
    async capture(event, properties) {
      events.push({ event, properties });
    },
    async captureException(error) {
      exceptions.push(error);
    },
    async flush() {},
  };

  return { events, exceptions, telemetry };
}

function emailAddressOfTest(value: EmailMessage["to"]): string {
  return typeof value === "string"
    ? value
    : Array.isArray(value)
      ? emailAddressOfTest(value[0])
      : value.email;
}

describe("createEmailClient v1", () => {
  test("uses the first adapter and returns the normalized result", async () => {
    const client = createEmailClient({ adapters: [adapter("primary")] });
    const result = await client.send(message);

    expect(client.defaultAdapter).toBe("primary");
    expect(client.adapter("primary").name).toBe("primary");
    expect(result).toEqual({ adapter: "primary", id: "primary_1" });
    expect("provider" in result).toBe(false);
    expect("messageId" in result).toBe(false);
  });

  test("fails construction for duplicate, unknown default, and unknown fallback names", () => {
    expect(() => createEmailClient({ adapters: [adapter("same"), adapter("same")] })).toThrow(
      'Duplicate email adapter "same".',
    );
    expect(() =>
      createEmailClient({ adapters: [adapter("one")], defaultAdapter: "missing" as "one" }),
    ).toThrow('Email adapter "missing" is not registered.');
    expect(() =>
      createEmailClient({
        adapters: [adapter("one")],
        fallback: { adapters: ["missing" as "one"] },
      }),
    ).toThrow('Email adapter "missing" is not registered.');
  });

  test("validates without sending and validates every candidate route", async () => {
    let sends = 0;
    const primary = adapter("primary", () => {
      sends += 1;
      return { adapter: "primary" };
    });
    const backup = adapter("backup", undefined, {
      capabilities: { ...capabilities, repeatedHeaders: false },
    });
    const client = createEmailClient({
      adapters: [primary, backup],
      fallback: { adapters: ["backup"] },
    });

    await expect(client.validate(message)).resolves.toEqual({ adapter: "primary", warnings: [] });
    expect(sends).toBe(0);

    await expect(
      client.validate({
        ...message,
        headers: [
          { name: "X-Test", value: "one" },
          { name: "x-test", value: "two" },
        ],
      }),
    ).rejects.toBeInstanceOf(EmailValidationError);
    expect(sends).toBe(0);
  });

  test("enforces message, attachment, and zoned RFC 3339 validation", async () => {
    const client = createEmailClient({ adapters: [adapter("primary")] });

    await expect(client.validate({ ...message, text: undefined } as EmailMessage)).rejects.toThrow(
      "requires either html or text",
    );
    await expect(
      client.validate({
        ...message,
        attachments: [{ filename: "bad.txt" } as never],
      }),
    ).rejects.toThrow("requires exactly one of content or path");
    await expect(
      client.validate({ ...message, sendAt: "2026-07-21T01:00:00Z" }),
    ).resolves.toMatchObject({ adapter: "primary" });
    await expect(
      client.validate({ ...message, sendAt: "2026-07-21T01:00:00+02:00" }),
    ).resolves.toMatchObject({ adapter: "primary" });
    await expect(
      client.validate({ ...message, sendAt: "2026-07-21T01:00:00" as never }),
    ).rejects.toThrow("must be an RFC 3339 timestamp");
  });

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

    const error = await client.send(message).catch((caught) => caught);
    expect(error).toBeInstanceOf(EmailRouteError);
    expect((error as EmailRouteError).failures.map((failure) => failure.adapter)).toEqual([
      "one",
      "two",
    ]);
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

  test("sendMany is sequential, ordered, settled, and replaces item fallback", async () => {
    const order: string[] = [];
    const client = createEmailClient({
      adapters: [
        adapter("primary", async (value) => {
          order.push(value.subject);
          if (value.subject === "fail") {
            throw new EmailAdapterError("no", {
              adapter: "primary",
              delivery: "not_sent",
            });
          }
          return { adapter: "primary", id: value.subject };
        }),
        adapter("backup"),
      ],
      fallback: { adapters: ["backup"] },
    });

    const results = await client.sendMany([
      { message: { ...message, subject: "first" } },
      {
        message: { ...message, subject: "fail" },
        options: { fallback: { adapters: [] } },
      },
      { message: { ...message, subject: "third" } },
    ]);

    expect(order).toEqual(["first", "fail", "third"]);
    expect(results.map((result) => [result.index, result.ok])).toEqual([
      [0, true],
      [1, false],
      [2, true],
    ]);
  });

  test("sendMany settles an unsupported scheduled item and continues", async () => {
    const sent: string[] = [];
    const client = createEmailClient({
      adapters: [
        adapter("scheduled", (value) => {
          sent.push(value.subject);
          return { adapter: "scheduled", id: value.subject };
        }),
        adapter("immediate", undefined, {
          capabilities: { ...capabilities, scheduling: false },
        }),
      ],
    });
    const sendAt = new Date("2026-08-01T09:00:00Z");

    const results = await client.sendMany([
      { message: { ...message, subject: "first", sendAt } },
      {
        message: { ...message, subject: "unsupported", sendAt },
        options: { adapter: "immediate" },
      },
      { message: { ...message, subject: "third", sendAt } },
    ]);

    expect(sent).toEqual(["first", "third"]);
    expect(results.map((result) => [result.index, result.ok])).toEqual([
      [0, true],
      [1, false],
      [2, true],
    ]);
    expect(results[1]?.ok === false ? results[1].error.code : undefined).toBe("validation_error");
  });

  test("sendPersonalized expands sequentially, derives keys, and resolves partial success", async () => {
    const calls: Array<{ to: unknown; key?: string }> = [];
    const client = createEmailClient({
      adapters: [
        adapter("expanded", (value, context) => {
          calls.push({ to: value.to, key: context.idempotencyKey });
          if (value.to === "bad@example.com") {
            throw new EmailAdapterError("bad", {
              adapter: "expanded",
              delivery: "not_sent",
            });
          }
          return { adapter: "expanded", id: "ok" };
        }),
      ],
    });

    const result = await client.sendPersonalized(
      {
        message: {
          from: message.from,
          subject: "Hi %recipient.name%",
          text: "Welcome %recipient.name%",
        },
        recipients: [
          { to: "good@example.com", variables: { name: "Ada" } },
          { to: "bad@example.com", variables: { name: "Linus" } },
        ],
      },
      { idempotencyKey: "campaign" },
    );

    expect(result.accepted).toEqual(["good@example.com"]);
    expect(result.rejected).toEqual(["bad@example.com"]);
    expect(calls).toEqual([
      { to: "good@example.com", key: "campaign:good@example.com" },
      { to: "bad@example.com", key: "campaign:bad@example.com" },
    ]);
  });

  test("expanded sendPersonalized preserves sendAt for every recipient", async () => {
    const calls: EmailMessage[] = [];
    const client = createEmailClient({
      adapters: [
        adapter("expanded", (value) => {
          calls.push(value);
          return { adapter: "expanded", id: emailAddressOfTest(value.to) };
        }),
      ],
    });
    const sendAt = new Date("2026-08-01T09:00:00Z");

    await client.sendPersonalized({
      message: {
        from: message.from,
        subject: "Hi %recipient.name%",
        text: "Welcome %recipient.name%",
        sendAt,
      },
      recipients: [
        { to: "ada@example.com", variables: { name: "Ada" } },
        { to: "linus@example.com", variables: { name: "Linus" } },
      ],
    });

    expect(calls.map((sent) => sent.sendAt)).toEqual([sendAt, sendAt]);
  });

  test("sendPersonalized applies beforeSend middleware to native and expanded delivery", async () => {
    let expandedBefore = 0;
    const expandedCalls: EmailMessage[] = [];
    const expandedClient = createEmailClient({
      adapters: [
        adapter("expanded", (value) => {
          expandedCalls.push(value);
          return { adapter: "expanded", id: emailAddressOfTest(value.to) };
        }),
      ],
      plugins: [
        {
          id: "personalized-defaults",
          middleware: [
            {
              beforeSend(event) {
                expandedBefore += 1;
                return {
                  message: {
                    ...event.message,
                    headers: [{ name: "X-Campaign", value: "welcome" }],
                    text: `${event.message.text} via middleware`,
                  },
                  options: { metadata: { campaign: "welcome" } },
                };
              },
            },
          ],
        },
      ],
    });

    await expandedClient.sendPersonalized({
      message: {
        from: message.from,
        subject: "Hi %recipient.name%",
        text: "Hello %recipient.name%",
      },
      recipients: [
        { to: "ada@example.com", variables: { name: "Ada" } },
        { to: "linus@example.com", variables: { name: "Linus" } },
      ],
    });

    expect(expandedBefore).toBe(1);
    expect(expandedCalls.map((sent) => sent.subject)).toEqual(["Hi Ada", "Hi Linus"]);
    expect(expandedCalls.map((sent) => sent.text)).toEqual([
      "Hello Ada via middleware",
      "Hello Linus via middleware",
    ]);
    expect(expandedCalls.every((sent) => sent.headers?.[0]?.name === "X-Campaign")).toBe(true);

    let nativeInput: unknown;
    let nativeContextMetadata: unknown;
    const nativeClient = createEmailClient({
      adapters: [
        adapter("native", undefined, {
          capabilities: { ...capabilities, personalized: "native" },
          sendPersonalized(value, context) {
            nativeInput = value;
            nativeContextMetadata = context.metadata;
            return {
              adapter: "native",
              accepted: value.recipients.map((recipient) => emailAddressOfTest(recipient.to)),
              rejected: [],
            };
          },
        }),
      ],
      plugins: [
        {
          id: "native-defaults",
          middleware: [
            {
              beforeSend(event) {
                return {
                  message: {
                    ...event.message,
                    headers: [{ name: "X-Native", value: "yes" }],
                  },
                  options: { metadata: { mode: "native" } },
                };
              },
            },
          ],
        },
      ],
    });

    await nativeClient.sendPersonalized({
      message: {
        from: message.from,
        subject: "Hi %recipient.name%",
        text: "Hello %recipient.name%",
      },
      recipients: [{ to: "ada@example.com", variables: { name: "Ada" } }],
    });

    expect(nativeInput).toMatchObject({
      message: {
        subject: "Hi %recipient.name%",
        text: "Hello %recipient.name%",
        headers: [{ name: "X-Native", value: "yes" }],
      },
    });
    expect("to" in (nativeInput as { message: object }).message).toBe(false);
    expect(nativeContextMetadata).toEqual({ mode: "native" });
  });

  test("sendPersonalized invokes error middleware and hooks for partial and all-recipient failures", async () => {
    const middlewareErrors: string[] = [];
    const hookErrors: string[] = [];
    const client = createEmailClient({
      adapters: [
        adapter("expanded", (value) => {
          if (value.to === "bad@example.com" || value.to === "worse@example.com") {
            throw new EmailAdapterError("recipient rejected", {
              adapter: "expanded",
              delivery: "not_sent",
            });
          }
          return { adapter: "expanded", id: "ok" };
        }),
      ],
      hooks: {
        onError(event) {
          hookErrors.push(emailAddressOfTest(event.message.to));
        },
      },
      plugins: [
        {
          id: "capture-errors",
          middleware: [
            {
              onError(event) {
                middlewareErrors.push(emailAddressOfTest(event.message.to));
              },
            },
          ],
        },
      ],
    });

    const partial = await client.sendPersonalized({
      message: { from: message.from, subject: "Hi", text: "Hello" },
      recipients: [
        { to: "good@example.com", variables: {} },
        { to: "bad@example.com", variables: {} },
      ],
    });

    expect(partial.accepted).toEqual(["good@example.com"]);
    expect(partial.rejected).toEqual(["bad@example.com"]);
    expect(middlewareErrors).toEqual(["bad@example.com"]);
    expect(hookErrors).toEqual(["bad@example.com"]);

    await expect(
      client.sendPersonalized({
        message: { from: message.from, subject: "Hi", text: "Hello" },
        recipients: [
          { to: "bad@example.com", variables: {} },
          { to: "worse@example.com", variables: {} },
        ],
      }),
    ).rejects.toBeInstanceOf(EmailAllRecipientsFailedError);
    expect(middlewareErrors).toEqual(["bad@example.com", "bad@example.com", "worse@example.com"]);
    expect(hookErrors).toEqual(["bad@example.com", "bad@example.com", "worse@example.com"]);
  });

  test("sendPersonalized invokes error lifecycle for native adapter failures", async () => {
    const errors: string[] = [];
    const client = createEmailClient({
      adapters: [
        adapter("native", undefined, {
          capabilities: { ...capabilities, personalized: "native" },
          sendPersonalized() {
            throw new EmailAdapterError("native failed", {
              adapter: "native",
              delivery: "not_sent",
            });
          },
        }),
      ],
      plugins: [
        {
          id: "capture-native-errors",
          middleware: [
            {
              onError(event) {
                errors.push(`${event.adapter}:${event.attempt}`);
              },
            },
          ],
        },
      ],
    });

    await expect(
      client.sendPersonalized({
        message: { from: message.from, subject: "Hi", text: "Hello" },
        recipients: [{ to: "bad@example.com", variables: {} }],
      }),
    ).rejects.toBeInstanceOf(EmailAllRecipientsFailedError);
    expect(errors).toEqual(["native:1"]);
  });

  test("sendPersonalized does not emit success lifecycle when native adapter rejects every recipient", async () => {
    const events: string[] = [];
    const client = createEmailClient({
      adapters: [
        adapter("native", undefined, {
          capabilities: { ...capabilities, personalized: "native" },
          sendPersonalized(value) {
            return {
              adapter: "native",
              accepted: [],
              rejected: value.recipients.map((recipient) => emailAddressOfTest(recipient.to)),
            };
          },
        }),
      ],
      hooks: {
        afterSend() {
          events.push("hook:afterSend");
        },
        onError() {
          events.push("hook:onError");
        },
      },
      plugins: [
        {
          id: "native-all-rejected-lifecycle",
          middleware: [
            {
              afterSend() {
                events.push("middleware:afterSend");
              },
              onError() {
                events.push("middleware:onError");
              },
            },
          ],
        },
      ],
    });

    await expect(
      client.sendPersonalized({
        message: { from: message.from, subject: "Hi", text: "Hello" },
        recipients: [
          { to: "bad@example.com", variables: {} },
          { to: "worse@example.com", variables: {} },
        ],
      }),
    ).rejects.toBeInstanceOf(EmailAllRecipientsFailedError);

    expect(events).toEqual(["middleware:onError", "hook:onError"]);
    expect(events.filter((event) => event.endsWith(":afterSend"))).toHaveLength(0);
    expect(events.filter((event) => event.endsWith(":onError"))).toHaveLength(2);
  });

  test("sendPersonalized emits safe telemetry for native and expanded delivery", async () => {
    const nativeCapture = telemetryCapture();
    setSharedTelemetry(nativeCapture.telemetry);
    try {
      const nativeClient = createEmailClient({
        adapters: [
          adapter("sendgrid", undefined, {
            capabilities: { ...capabilities, personalized: "native" },
            sendPersonalized() {
              return {
                adapter: "sendgrid",
                accepted: ["ada@example.com", "linus@example.com"],
                rejected: ["bad@example.com"],
              };
            },
          }),
        ],
      });

      await nativeClient.sendPersonalized({
        message: {
          from: message.from,
          subject: "Hi %recipient.name%",
          text: "Hello %recipient.name%",
        },
        recipients: [
          { to: "ada@example.com", variables: { name: "Ada" } },
          { to: "linus@example.com", variables: { name: "Linus" } },
          { to: "bad@example.com", variables: { name: "Bad" } },
        ],
      });

      const nativeEvent = nativeCapture.events.findLast((item) => item.event === "email sent");
      expect(nativeEvent?.properties).toMatchObject({
        adapter: "sendgrid",
        delivery_path: "personalized_native",
        success: true,
        recipients: 3,
        personalized_recipient_count: 3,
        used_recipient_variables: true,
        logical_operation_count: 1,
        source: "sdk",
      });
      expect(JSON.stringify(nativeEvent?.properties)).not.toContain("Ada");
      expect(JSON.stringify(nativeEvent?.properties)).not.toContain("ada@example.com");
      expect(
        nativeCapture.events.find((item) => item.event === "email adapter attempted")?.properties,
      ).toMatchObject({
        accepted_message_count: 2,
        accepted_recipient_count: 2,
        rejected_recipient_count: 1,
        unknown_recipient_count: 0,
        adapter_attempt_count: 1,
      });
      expect(nativeCapture.exceptions).toHaveLength(0);
    } finally {
      resetTelemetry();
    }

    const expandedCapture = telemetryCapture();
    setSharedTelemetry(expandedCapture.telemetry);
    try {
      const expandedClient = createEmailClient({
        adapters: [
          adapter("resend", (value) => {
            if (value.to === "bad@example.com") {
              throw new EmailAdapterError("bad", {
                adapter: "resend",
                delivery: "not_sent",
              });
            }
            return { adapter: "resend", id: "ok" };
          }),
        ],
      });

      await expandedClient.sendPersonalized({
        message: { from: message.from, subject: "Hi", text: "Hello" },
        recipients: [
          { to: "good@example.com", variables: {} },
          { to: "bad@example.com", variables: {} },
        ],
      });

      const expandedEvent = expandedCapture.events.findLast((item) => item.event === "email sent");
      expect(expandedEvent?.properties).toMatchObject({
        adapter: "resend",
        delivery_path: "personalized_expanded",
        success: true,
        recipients: 2,
        logical_operation_count: 1,
      });
      expect(expandedCapture.exceptions).toHaveLength(0);
    } finally {
      resetTelemetry();
    }
  });

  test("logical operations never infer acceptance from successful results", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const client = createEmailClient({
        adapters: [
          adapter("resend", (value) => {
            if (value.to === "bad@example.com") {
              throw new EmailAdapterError("bad", { adapter: "resend", delivery: "not_sent" });
            }
            return { adapter: "resend", id: "ok" };
          }),
        ],
      });

      // One message shared by three addresses is one email, not three.
      await client.send({
        ...message,
        to: ["a@example.com", "b@example.com"],
        cc: "c@example.com",
      });

      // Personalized fans out to one message per recipient; one fails.
      await client.sendPersonalized({
        message: { from: message.from, subject: "Hi", text: "Hello" },
        recipients: [
          { to: "good@example.com", variables: {} },
          { to: "bad@example.com", variables: {} },
        ],
      });

      await expect(client.send({ ...message, to: "bad@example.com" })).rejects.toBeDefined();

      const sends = capture.events.filter((item) => item.event === "email sent");
      expect(sends.map((item) => item.properties?.message_count)).toEqual([1, 2, 1]);
      expect(sends.map((item) => item.properties?.logical_operation_count)).toEqual([1, 1, 1]);
      expect(sends.map((item) => item.properties?.operation_failure_count)).toEqual([0, 0, 1]);
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts).toHaveLength(4);
      expect(attempts.map((item) => item.properties?.accepted_recipient_count)).toEqual([
        0, 0, 0, 0,
      ]);
      expect(attempts.map((item) => item.properties?.unknown_recipient_count)).toEqual([
        3, 1, 0, 0,
      ]);
      for (const item of capture.events)
        expect(item.properties).not.toHaveProperty("delivered_count");
    } finally {
      resetTelemetry();
    }
  });

  test("sendMany counts every item once on 'email sent'", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);

    try {
      const client = createEmailClient({ adapters: [adapter("resend")] });
      await client.sendMany([{ message }, { message }, { message }]);

      const operations = capture.events.reduce(
        (total, item) => total + Number(item.properties?.logical_operation_count ?? 0),
        0,
      );
      const attempts = capture.events.reduce(
        (total, item) => total + Number(item.properties?.adapter_attempt_count ?? 0),
        0,
      );
      const batch = capture.events.find((item) => item.event === "email batch sent");
      expect(operations).toBe(3);
      expect(attempts).toBe(3);
      expect(batch?.properties).toMatchObject({ message_count: 3, succeeded: 3 });
      expect(batch?.properties).not.toHaveProperty("delivered_count");
    } finally {
      resetTelemetry();
    }
  });

  test("attempt measurements separate retries, fallback, and partial acceptance", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);
    try {
      let calls = 0;
      const client = createEmailClient({
        adapters: [
          adapter("resend", () => {
            calls++;
            throw new EmailAdapterError("private provider detail", {
              adapter: "resend",
              retryable: true,
              delivery: calls === 1 ? "unknown" : "not_sent",
            });
          }),
          adapter("smtp", () => ({
            adapter: "smtp",
            accepted: ["a@example.com"],
            rejected: ["b@example.com"],
          })),
        ],
        retry: { maxAttempts: 2, delay: () => 0, shouldRetry: () => true },
        fallback: { adapters: ["smtp"] },
      });
      await client.send({ ...message, to: ["a@example.com", "b@example.com"] });
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts).toHaveLength(3);
      expect(attempts.map((item) => item.properties?.adapter)).toEqual([
        "resend",
        "resend",
        "smtp",
      ]);
      expect(attempts.map((item) => item.properties?.uncertain_attempt_count)).toEqual([1, 0, 0]);
      expect(attempts.map((item) => item.properties?.not_sent_attempt_count)).toEqual([0, 1, 0]);
      expect(attempts[2]?.properties).toMatchObject({
        accepted_message_count: 1,
        accepted_recipient_count: 1,
        rejected_recipient_count: 1,
      });
      expect(capture.events.filter((item) => item.event === "email sent")).toHaveLength(1);
      expect(JSON.stringify(attempts)).not.toContain("@example.com");
      expect(JSON.stringify(attempts)).not.toContain("private provider detail");
    } finally {
      resetTelemetry();
    }
  });

  test("validation, pre-abort, and before middleware failures never count attempts", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);
    try {
      const client = createEmailClient({ adapters: [adapter("resend")] });
      await client.validate(message);
      expect(capture.events.filter((item) => item.event !== "client created")).toHaveLength(0);
      await expect(client.send({ ...message, to: [] })).rejects.toBeDefined();
      await expect(client.send(message, { signal: AbortSignal.abort() })).rejects.toBeDefined();
      const blocked = createEmailClient({
        adapters: [adapter("resend")],
        plugins: [
          {
            id: "block",
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
      await expect(blocked.send(message)).rejects.toBeDefined();
      expect(
        capture.events.filter((item) => item.event === "email adapter attempted"),
      ).toHaveLength(0);
      expect(capture.events.filter((item) => item.event === "email sent")).toHaveLength(3);
    } finally {
      resetTelemetry();
    }
  });

  test.each(["single", "native", "expanded"])(
    "%s retains acceptance before after-send middleware failure",
    async (path) => {
      const capture = telemetryCapture();
      setSharedTelemetry(capture.telemetry);
      try {
        const result = { adapter: "resend", accepted: ["a@example.com"], rejected: [] };
        const client = createEmailClient({
          adapters: [
            adapter(
              "resend",
              () => result,
              path === "native" ? { sendPersonalized: () => result } : {},
            ),
          ],
          plugins: [
            {
              id: "after",
              middleware: [
                {
                  afterSend() {
                    throw new Error("after failed");
                  },
                },
              ],
            },
          ],
        });
        const operation =
          path === "single"
            ? client.send(message)
            : client.sendPersonalized({
                message,
                recipients: [{ to: "a@example.com", variables: {} }],
              });
        await expect(operation).rejects.toBeInstanceOf(EmailMiddlewareError);
        expect(
          capture.events.find((item) => item.event === "email adapter attempted")?.properties,
        ).toMatchObject({
          accepted_message_count: 1,
          accepted_recipient_count: 1,
          adapter_failure_count: 0,
        });
        expect(
          capture.events.find((item) => item.event === "email sent")?.properties,
        ).toMatchObject({ operation_failure_count: 1 });
      } finally {
        resetTelemetry();
      }
    },
  );

  test("abort after adapter resolution preserves explicit acceptance", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);
    try {
      const controller = new AbortController();
      const client = createEmailClient({
        adapters: [
          adapter("smtp", () => {
            controller.abort();
            return { adapter: "smtp", accepted: ["a@example.com"] };
          }),
        ],
      });
      await expect(client.send(message, { signal: controller.signal })).rejects.toBeInstanceOf(
        EmailAbortError,
      );
      expect(
        capture.events.find((item) => item.event === "email adapter attempted")?.properties,
      ).toMatchObject({
        accepted_recipient_count: 1,
        uncertain_attempt_count: 0,
        adapter_resolved_count: 1,
      });
    } finally {
      resetTelemetry();
    }
  });

  test("native errors and expanded unknown failures do not fabricate rejection", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);
    try {
      const fail = () => {
        throw new EmailAdapterError("partial outcome", { adapter: "smtp", delivery: "unknown" });
      };
      const input = {
        message,
        recipients: [
          { to: "a@example.com", variables: {} },
          { to: "b@example.com", variables: {} },
        ],
      };
      for (const native of [true, false]) {
        const client = createEmailClient({
          adapters: [adapter("smtp", fail, native ? { sendPersonalized: fail } : {})],
        });
        await expect(client.sendPersonalized(input)).rejects.toBeInstanceOf(
          EmailAllRecipientsFailedError,
        );
      }
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts.map((item) => item.properties?.unknown_recipient_count)).toEqual([2, 1, 1]);
      for (const item of attempts)
        expect(item.properties).toMatchObject({
          rejected_recipient_count: 0,
          accepted_recipient_count: 0,
          uncertain_attempt_count: 1,
        });
    } finally {
      resetTelemetry();
    }
  });

  test("attempt facts use middleware-prepared recipients and the actual adapter", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);
    try {
      const client = createEmailClient({
        adapters: [adapter("resend"), adapter("smtp")],
        plugins: [
          {
            id: "reroute",
            middleware: [
              {
                beforeSend: () => ({
                  message: {
                    ...message,
                    to: ["a@example.com", "b@example.com"],
                    bcc: "c@example.com",
                  },
                  options: { adapter: "smtp" },
                }),
              },
            ],
          },
        ],
      });
      await client.send(message);
      expect(
        capture.events.find((item) => item.event === "email adapter attempted")?.properties,
      ).toMatchObject({ adapter: "smtp", attempted_recipient_count: 3 });
    } finally {
      resetTelemetry();
    }
  });

  test.each(["memory", "resend", "private-custom-name"])(
    "%s injected captures never contribute real provider volume",
    async (name) => {
      const capture = telemetryCapture();
      setSharedTelemetry(capture.telemetry);
      try {
        await createEmailClient({
          adapters: [adapter(name, () => ({ adapter: name, accepted: ["a@example.com"] }))],
        }).send(message);
        expect(
          capture.events.find((item) => item.event === "email adapter attempted")?.properties,
        ).toMatchObject({
          provider_volume_eligible: false,
          provider_attempt_count: 0,
          provider_accepted_message_count: 0,
          provider_accepted_recipient_count: 0,
          accepted_recipient_count: 1,
        });
        expect(JSON.stringify(capture.events)).not.toContain("private-custom-name");
      } finally {
        resetTelemetry();
      }
    },
  );

  test("native retry and fallback emit one observation per call, not per recipient", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);
    try {
      let calls = 0;
      const client = createEmailClient({
        adapters: [
          adapter("sendgrid", undefined, {
            sendPersonalized() {
              if (++calls === 1)
                throw new EmailAdapterError("retry", {
                  adapter: "sendgrid",
                  delivery: "not_sent",
                  retryable: true,
                });
              return {
                adapter: "sendgrid",
                accepted: [],
                rejected: ["a@example.com", "b@example.com"],
              };
            },
          }),
          adapter("resend", (value) => ({
            adapter: "resend",
            accepted: [emailAddressOfTest(value.to)],
          })),
        ],
        retry: { maxAttempts: 2, delay: () => 0 },
        fallback: { adapters: ["resend"] },
      });
      await client.sendPersonalized({
        message,
        recipients: [
          { to: "a@example.com", variables: {} },
          { to: "b@example.com", variables: {} },
        ],
      });
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts).toHaveLength(4);
      expect(attempts.map((item) => item.properties?.accepted_message_count)).toEqual([0, 0, 1, 1]);
      expect(attempts.map((item) => item.properties?.rejected_recipient_count)).toEqual([
        0, 2, 0, 0,
      ]);
      expect(attempts.map((item) => item.properties?.adapter_failure_count)).toEqual([1, 0, 0, 0]);
      expect(capture.events.filter((item) => item.event === "email sent")).toHaveLength(1);
    } finally {
      resetTelemetry();
    }
  });

  test("expanded resolved rejection is not treated as telemetry acceptance", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);
    try {
      const client = createEmailClient({
        adapters: [
          adapter("smtp", () => ({ adapter: "smtp", accepted: [], rejected: ["a@example.com"] })),
        ],
      });
      await client.sendPersonalized({
        message,
        recipients: [{ to: "a@example.com", variables: {} }],
      });
      expect(
        capture.events.find((item) => item.event === "email adapter attempted")?.properties,
      ).toMatchObject({
        adapter_resolved_count: 1,
        accepted_message_count: 0,
        accepted_recipient_count: 0,
        rejected_recipient_count: 1,
        unknown_recipient_count: 0,
      });
    } finally {
      resetTelemetry();
    }
  });

  test("empty and mixed-outcome batches are summaries without volume counters", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);
    try {
      const client = createEmailClient({
        adapters: [adapter("resend", () => ({ adapter: "resend", accepted: ["a@example.com"] }))],
      });
      await client.sendMany([]);
      await client.sendMany([{ message }, { message: { ...message, to: [] } }]);
      const batches = capture.events.filter((item) => item.event === "email batch sent");
      expect(batches.map((item) => item.properties?.message_count)).toEqual([0, 2]);
      expect(batches[1]?.properties).toMatchObject({
        succeeded: 1,
        failed: 1,
        measurement_scope: "batch_summary",
      });
      for (const item of batches) {
        expect(item.properties).not.toHaveProperty("logical_operation_count");
        expect(item.properties).not.toHaveProperty("adapter_attempt_count");
        expect(item.properties).not.toHaveProperty("accepted_message_count");
      }
      expect(
        capture.events.reduce(
          (sum, item) => sum + Number(item.properties?.accepted_message_count ?? 0),
          0,
        ),
      ).toBe(1);
    } finally {
      resetTelemetry();
    }
  });

  test.each([false, true])(
    "partial provider errors preserve valid aggregate acceptance (native=%s)",
    async (native) => {
      const capture = telemetryCapture();
      setSharedTelemetry(capture.telemetry);
      try {
        const fail = () => {
          throw new EmailAdapterError("partial", {
            adapter: "lettr",
            delivery: "unknown",
            acceptedCount: 2,
            rejectedCount: 1,
            requestId: "private-request-id",
          });
        };
        const client = createEmailClient({
          adapters: [adapter("lettr", fail, native ? { sendPersonalized: fail } : {})],
        });
        const recipients = ["a@example.com", "b@example.com", "c@example.com"];
        await expect(
          native
            ? client.sendPersonalized({
                message,
                recipients: recipients.map((to) => ({ to, variables: {} })),
              })
            : client.send({ ...message, to: recipients }),
        ).rejects.toBeDefined();
        const attempt = capture.events.find((item) => item.event === "email adapter attempted");
        expect(attempt?.properties).toMatchObject({
          accepted_message_count: native ? 2 : 1,
          accepted_recipient_count: 2,
          rejected_recipient_count: 1,
          unknown_recipient_count: 0,
          adapter_failure_count: 1,
          uncertain_attempt_count: 1,
        });
        expect(JSON.stringify(attempt)).not.toContain("private-request-id");
      } finally {
        resetTelemetry();
      }
    },
  );

  test.each([
    [2, 2],
    [1, 0],
    [-1, 4],
    [NaN, 3],
    [0.5, 2.5],
  ])("invalid provider counts %s/%s remain unknown", async (acceptedCount, rejectedCount) => {
    const capture = telemetryCapture();
    setSharedTelemetry(capture.telemetry);
    try {
      const client = createEmailClient({
        adapters: [
          adapter("lettr", () => {
            throw new EmailAdapterError("inconsistent", {
              adapter: "lettr",
              delivery: "unknown",
              acceptedCount,
              rejectedCount,
            });
          }),
        ],
      });
      await expect(
        client.send({ ...message, to: ["a@example.com", "b@example.com", "c@example.com"] }),
      ).rejects.toBeDefined();
      expect(
        capture.events.find((item) => item.event === "email adapter attempted")?.properties,
      ).toMatchObject({
        accepted_recipient_count: 0,
        rejected_recipient_count: 0,
        unknown_recipient_count: 3,
      });
    } finally {
      resetTelemetry();
    }
  });

  test("runtime provider volume excludes memory but includes anonymized custom adapters", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry({ ...capture.telemetry, realProviderVolume: true });
    try {
      for (const name of ["resend", "memory", "private-adapter"]) {
        await createEmailClient({
          adapters: [adapter(name, () => ({ adapter: name, accepted: ["a@example.com"] }))],
        }).send(message);
      }
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts.map((item) => item.properties?.provider_attempt_count)).toEqual([1, 0, 1]);
      expect(attempts.map((item) => item.properties?.provider_accepted_message_count)).toEqual([
        1, 0, 1,
      ]);
      expect(attempts.map((item) => item.properties?.provider_accepted_recipient_count)).toEqual([
        1, 0, 1,
      ]);
      expect(attempts[2]?.properties).toMatchObject({
        adapter: "custom",
        adapter_kind: "custom",
        provider_volume_eligible: true,
      });
      expect(JSON.stringify(attempts)).not.toContain("private-adapter");
    } finally {
      resetTelemetry();
    }
  });

  test("renamed provider routes retain volume without exposing their names", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry({ ...capture.telemetry, realProviderVolume: true });
    try {
      const backup = {
        ...resend({
          apiKey: "test-key",
          fetch: (async () => Response.json({ id: "private-receipt" })) as typeof fetch,
        }),
        name: "private-backup-route",
      };
      const primary = adapter("resend", () => {
        throw new EmailAdapterError("unavailable", { adapter: "resend", delivery: "not_sent" });
      });
      await createEmailClient({
        adapters: [primary, backup],
        fallback: { adapters: [backup.name] },
      }).send(message);
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts.map((item) => item.properties?.provider_attempt_count)).toEqual([1, 1]);
      expect(attempts.map((item) => item.properties?.provider_submitted_message_count)).toEqual([0, 1]);
      expect(attempts[1]?.properties).toMatchObject({
        adapter: "custom",
        adapter_kind: "custom",
        provider_volume_eligible: true,
        acceptance_basis: "inferred_from_success",
      });
      expect(JSON.stringify(capture.events)).not.toContain("private-backup-route");
      expect(JSON.stringify(capture.events)).not.toContain("private-receipt");
    } finally {
      resetTelemetry();
    }
  });

  test("real Resend ID-only results count submissions without inventing explicit acceptance", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry({ ...capture.telemetry, realProviderVolume: true });
    let requests = 0;
    try {
      const client = createEmailClient({
        adapters: [
          resend({
            apiKey: "test-key",
            fetch: (async () => {
              requests++;
              return Response.json({ id: "private-message-id" });
            }) as typeof fetch,
          }),
        ],
      });
      await client.send({
        ...message,
        to: ["a@example.com", "b@example.com"],
        cc: "c@example.com",
        bcc: "d@example.com",
      });
      await client.sendPersonalized({
        message,
        recipients: [
          { to: "a@example.com", variables: {} },
          { to: "b@example.com", variables: {} },
        ],
      });
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(requests).toBe(3);
      expect(attempts.map((item) => item.properties?.provider_submitted_message_count)).toEqual([
        1, 1, 1,
      ]);
      expect(attempts.map((item) => item.properties?.provider_submitted_recipient_count)).toEqual([
        4, 1, 1,
      ]);
      for (const item of attempts)
        expect(item.properties).toMatchObject({
          adapter_kind: "provider",
          provider_volume_eligible: true,
          acceptance_basis: "inferred_from_success",
          accepted_message_count: 0,
          accepted_recipient_count: 0,
          provider_accepted_message_count: 0,
          provider_accepted_recipient_count: 0,
        });
      expect(JSON.stringify(attempts)).not.toContain("private-message-id");
      expect(JSON.stringify(attempts)).not.toContain("@example.com");
    } finally {
      resetTelemetry();
    }
  });

  test("test-adapter markers survive built-in names, spread, renaming, and native extensions", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry({ ...capture.telemetry, realProviderVolume: true });
    try {
      for (const testAdapter of [
        memoryAdapter("resend"),
        failingAdapter("resend"),
        { ...memoryAdapter("private"), name: "resend" },
        { ...failingAdapter("private"), name: "resend" },
      ]) {
        await createEmailClient({ adapters: [testAdapter] }).sendMany([{ message }]);
        const extended = {
          ...testAdapter,
          sendPersonalized: () => ({
            adapter: "resend",
            accepted: ["a@example.com"],
            rejected: [],
          }),
        };
        await createEmailClient({ adapters: [extended] }).sendPersonalized({
          message,
          recipients: [{ to: "a@example.com", variables: {} }],
        });
      }
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts).toHaveLength(8);
      for (const item of attempts)
        expect(item.properties).toMatchObject({
          adapter: "resend",
          adapter_kind: "test",
          provider_volume_eligible: false,
          provider_attempt_count: 0,
          provider_accepted_message_count: 0,
          provider_accepted_recipient_count: 0,
          provider_submitted_message_count: 0,
          provider_submitted_recipient_count: 0,
        });
    } finally {
      resetTelemetry();
    }
  });

  test("explicit empty or rejected results never infer recipient submissions", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry({ ...capture.telemetry, realProviderVolume: true });
    try {
      for (const result of [
        { adapter: "resend", accepted: [] },
        { adapter: "resend", rejected: ["a@example.com", "b@example.com"] },
        { adapter: "resend", accepted: [], rejected: ["a@example.com", "b@example.com"] },
        { adapter: "resend", accepted: ["a@example.com"], rejected: ["b@example.com"] },
      ]) {
        await createEmailClient({ adapters: [adapter("resend", () => result)] }).send({
          ...message,
          to: ["a@example.com", "b@example.com"],
        });
      }
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts.map((item) => item.properties?.provider_submitted_message_count)).toEqual([
        0, 0, 0, 1,
      ]);
      expect(attempts.map((item) => item.properties?.provider_submitted_recipient_count)).toEqual([
        0, 0, 0, 1,
      ]);
      expect(attempts.map((item) => item.properties?.acceptance_basis)).toEqual([
        "explicit",
        "explicit",
        "explicit",
        "explicit",
      ]);
    } finally {
      resetTelemetry();
    }
  });

  test("partial typed errors retain submissions while unknown failures do not infer them", async () => {
    const capture = telemetryCapture();
    setSharedTelemetry({ ...capture.telemetry, realProviderVolume: true });
    try {
      for (const counts of [
        { acceptedCount: 1, rejectedCount: 1 },
        {},
        { acceptedCount: 4, rejectedCount: 0 },
      ]) {
        await createEmailClient({
          adapters: [
            adapter("lettr", () => {
              throw new EmailAdapterError("partial", {
                adapter: "lettr",
                delivery: "unknown",
                ...counts,
              });
            }),
          ],
        }).sendMany([{ message: { ...message, to: ["a@example.com", "b@example.com"] } }]);
      }
      const attempts = capture.events.filter((item) => item.event === "email adapter attempted");
      expect(attempts.map((item) => item.properties?.provider_submitted_recipient_count)).toEqual([
        1, 0, 0,
      ]);
      expect(attempts.map((item) => item.properties?.provider_accepted_recipient_count)).toEqual([
        1, 0, 0,
      ]);
      expect(attempts.map((item) => item.properties?.acceptance_basis)).toEqual([
        "explicit",
        "unknown",
        "unknown",
      ]);
    } finally {
      resetTelemetry();
    }
  });

  test("client.flush() waits for the telemetry request to actually land", async () => {
    let releaseResponse: (() => void) | undefined;
    const responseGate = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const delivered: string[] = [];

    const fetchFn = (async (_url: URL | RequestInfo, init?: RequestInit) => {
      await responseGate;
      delivered.push(JSON.parse(String(init?.body)).event);
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    setSharedTelemetry(
      createTelemetry({
        env: {},
        fetch: fetchFn,
        configDir: join(mkdtempSync(join(tmpdir(), "email-sdk-flush-")), "email-sdk"),
        notify: () => {},
      }),
    );

    try {
      const client = createEmailClient({ adapters: [adapter("resend")] });
      await client.send(message);

      // send() resolves while the POST is still open — on serverless the runtime
      // freezes here and the event is lost. flush() is what closes that window.
      expect(delivered).toHaveLength(0);

      releaseResponse?.();
      await client.flush();
      expect(delivered).toContain("email sent");
    } finally {
      resetTelemetry();
    }
  });

  test("client.flush() resolves when telemetry is disabled", async () => {
    const client = createEmailClient({ adapters: [adapter("resend")], telemetry: false });
    await expect(client.flush()).resolves.toBeUndefined();
  });

  test("sendPersonalized throws when every recipient fails", async () => {
    const client = createEmailClient({
      adapters: [
        adapter("expanded", () => {
          throw new EmailAdapterError("bad", {
            adapter: "expanded",
            delivery: "not_sent",
          });
        }),
      ],
    });

    await expect(
      client.sendPersonalized({
        message: { from: message.from, subject: "Hi", text: "Hello" },
        recipients: [{ to: "bad@example.com", variables: {} }],
      }),
    ).rejects.toBeInstanceOf(EmailAllRecipientsFailedError);
  });

  test("wraps middleware exceptions but isolates hook exceptions", async () => {
    const middlewareClient = createEmailClient({
      adapters: [adapter("primary")],
      plugins: [
        {
          id: "middleware",
          middleware: [
            {
              beforeSend() {
                throw new Error("middleware failed");
              },
            },
          ],
        },
      ],
    });
    await expect(middlewareClient.send(message)).rejects.toBeInstanceOf(EmailMiddlewareError);

    const hookClient = createEmailClient({
      adapters: [adapter("primary")],
      hooks: {
        beforeSend() {
          throw new Error("hook failed");
        },
      },
    });
    await expect(hookClient.send(message)).resolves.toMatchObject({ adapter: "primary" });
  });
});
