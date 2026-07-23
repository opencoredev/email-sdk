import { describe, expect, test } from "bun:test";

import { createEmailClient } from "./core.js";
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
import { resetTelemetry, setSharedTelemetry } from "./telemetry.js";

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
  return typeof value === "string" ? value : Array.isArray(value) ? emailAddressOfTest(value[0]) : value.email;
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
      message: { from: message.from, subject: "Hi %recipient.name%", text: "Hello %recipient.name%" },
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
      message: { from: message.from, subject: "Hi %recipient.name%", text: "Hello %recipient.name%" },
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
    expect(middlewareErrors).toEqual([
      "bad@example.com",
      "bad@example.com",
      "worse@example.com",
    ]);
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
        message: { from: message.from, subject: "Hi %recipient.name%", text: "Hello %recipient.name%" },
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
        accepted_recipient_count: 2,
        rejected_recipient_count: 1,
        failure_count: 0,
        source: "sdk",
      });
      expect(JSON.stringify(nativeEvent?.properties)).not.toContain("Ada");
      expect(JSON.stringify(nativeEvent?.properties)).not.toContain("ada@example.com");
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
        accepted_recipient_count: 1,
        rejected_recipient_count: 1,
        failure_count: 1,
      });
      expect(expandedCapture.exceptions).toHaveLength(0);
    } finally {
      resetTelemetry();
    }
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
