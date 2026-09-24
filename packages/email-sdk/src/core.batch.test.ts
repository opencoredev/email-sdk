import { describe, expect, test } from "bun:test";
import { createEmailClient } from "./core.js";
import { EmailAdapterError, EmailAllRecipientsFailedError } from "./errors.js";
import type { EmailMessage, EmailPersonalizedInput } from "./types.js";
import {
  adapter,
  capabilities,
  emailAddressOfTest,
  message,
} from "../test-support/core-fixtures.js";
import { defined } from "../test-support/assertions.js";

describe("createEmailClient v1", () => {
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

    let nativeInput: EmailPersonalizedInput | undefined;
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
    expect("to" in defined(nativeInput).message).toBe(false);
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
});
