import { describe, expect, test } from "bun:test";
import { EmailAdapterError, EmailValidationError } from "./errors.js";
import type { JsonValue } from "./internal/decode.js";
import { reloop } from "./reloop.js";
import type { EmailMessage } from "./types.js";
import { base64, context, jsonCapture, messageWithoutMetadata } from "../test-support/adapter-fixtures.js";

const sent = {
  success: true,
  messageId: "<msg_123@example.com>",
  status: "sent",
  timestamp: "2026-10-16T00:00:00.000Z",
  id: "log_123",
};

const base: EmailMessage = {
  from: "hello@example.com",
  to: "ada@example.com",
  subject: "Hi",
  html: "<p>Hi</p>",
};

describe("provider payloads", () => {
  test("Reloop maps normalized fields and encodes attachments", async () => {
    const capture = jsonCapture(sent);

    const response = await reloop({ apiKey: "rl_key", fetch: capture.fetch }).send(
      { ...messageWithoutMetadata, sendAt: "2026-11-01T09:00:00.000Z" },
      context,
    );

    expect(response).toMatchObject({ adapter: "reloop", id: "log_123", raw: sent });
    expect(capture.calls[0]?.url).toBe("https://reloop.sh/api/mail/v1/send");
    expect(capture.calls[0]?.headers.get("x-api-key")).toBe("rl_key");
    expect(capture.calls[0]?.headers.has("authorization")).toBe(false);
    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
    expect(capture.calls[0]?.json).toEqual({
      from: "Acme <hello@example.com>",
      to: ["Ada <ada@example.com>"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      reply_to: ["reply@example.com"],
      subject: "Welcome",
      html: "<p>Hello</p>",
      text: "Hello",
      headers: { "X-Test": "yes" },
      attachments: [
        {
          content: base64("hello"),
          filename: "hello.txt",
          content_type: "text/plain",
        },
      ],
      tags: [{ name: "kind", value: "welcome" }],
      scheduled_at: "2026-11-01T09:00:00.000Z",
    });
  });

  test("Reloop omits optional fields and sends inline content ids", async () => {
    const capture = jsonCapture(sent);

    await reloop({ apiKey: "rl_key", baseUrl: "https://mail.example.com", fetch: capture.fetch }).send(
      {
        ...base,
        attachments: [
          { filename: "logo.png", content: "png", contentType: "image/png", contentId: "logo" },
        ],
      },
      { ...context, idempotencyKey: undefined },
    );

    expect(capture.calls[0]?.url).toBe("https://mail.example.com/api/mail/v1/send");
    expect(capture.calls[0]?.headers.has("idempotency-key")).toBe(false);
    expect(capture.calls[0]?.json).toEqual({
      from: "hello@example.com",
      to: ["ada@example.com"],
      subject: "Hi",
      html: "<p>Hi</p>",
      attachments: [
        {
          content: base64("png"),
          filename: "logo.png",
          content_type: "image/png",
          content_id: "logo",
        },
      ],
    });
  });

  test("Reloop hashes idempotency keys longer than 500 characters", async () => {
    const send = async (idempotencyKey: string) => {
      const capture = jsonCapture(sent);

      await reloop({ apiKey: "rl_key", fetch: capture.fetch }).send(base, {
        ...context,
        idempotencyKey,
      });

      return capture.calls[0]?.headers.get("idempotency-key");
    };

    const long = `${"k".repeat(500)}:ada@example.com`;
    const first = await send(long);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await send(long)).toBe(first);
    expect(await send(`${"k".repeat(500)}:bob@example.com`)).not.toBe(first);
    expect(await send("k".repeat(500))).toBe("k".repeat(500));
  });

  test("Reloop gives a per-send idempotency key precedence over static headers", async () => {
    const capture = jsonCapture(sent);

    await reloop({
      apiKey: "rl_key",
      headers: { "idempotency-key": "static" },
      fetch: capture.fetch,
    }).send(base, context);

    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
  });

  test.each([
    ["an empty body", ""],
    ["malformed JSON", "{"],
    ["a body without an email id", JSON.stringify({ success: true, status: "sent" })],
  ])("Reloop reports a 200 with %s as an unknown outcome", async (_label, responseBody) => {
    const fetcher: typeof fetch = async () =>
      new Response(responseBody, { status: 200, headers: { "content-type": "application/json" } });

    const send = reloop({ apiKey: "rl_key", fetch: fetcher }).send(base, context);

    await expect(send).rejects.toBeInstanceOf(EmailAdapterError);
    await expect(send).rejects.toMatchObject({ retryable: false, delivery: "unknown", status: 200 });
  });

  test("Reloop surfaces message, why, and fix with delivery state", async () => {
    const send = (body: JsonValue, status: number) =>
      reloop({ apiKey: "rl_key", fetch: jsonCapture(body, { status }).fetch }).send(base, context);

    await expect(
      send(
        {
          message: "All recipients are suppressed",
          why: "Every recipient is on the suppression list.",
          fix: "Remove suppressed addresses and send again.",
        },
        400,
      ),
    ).rejects.toMatchObject({
      message:
        "Reloop failed with 400: All recipients are suppressed. Every recipient is on the suppression list. Remove suppressed addresses and send again.",
      status: 400,
      delivery: "not_sent",
      retryable: false,
    });
    await expect(
      send({ message: "Email quota exceeded", why: "The monthly quota is used up." }, 402),
    ).rejects.toMatchObject({ status: 402, delivery: "not_sent", retryable: false });
    await expect(
      send({ message: "Too Many Requests", why: "Rate limit exceeded on the organization layer." }, 429),
    ).rejects.toMatchObject({ status: 429, delivery: "not_sent", retryable: true });
    await expect(send({ message: "Authentication required" }, 401)).rejects.toMatchObject({
      status: 401,
      delivery: "not_sent",
      retryable: false,
    });
    await expect(send({ message: "Conflict" }, 409)).rejects.toMatchObject({
      status: 409,
      delivery: "unknown",
    });
    await expect(send({ message: "Request Timeout" }, 408)).rejects.toMatchObject({
      status: 408,
      delivery: "unknown",
    });
    await expect(send({ message: "Internal Server Error" }, 500)).rejects.toMatchObject({
      status: 500,
      delivery: "unknown",
      retryable: true,
    });
  });

  test("Reloop reports an empty 401 body", async () => {
    const fetcher: typeof fetch = async () => new Response("", { status: 401 });

    await expect(reloop({ apiKey: "bad", fetch: fetcher }).send(base, context)).rejects.toMatchObject({
      status: 401,
      delivery: "not_sent",
      retryable: false,
    });
  });

  test("Reloop rejects shapes its API cannot represent before fetch", async () => {
    const capture = jsonCapture(sent);
    const adapter = reloop({ apiKey: "rl_key", fetch: capture.fetch });
    const many = Array.from({ length: 51 }, (_, index) => `user${index}@example.com`);

    for (const invalid of [
      { ...base, to: many },
      { ...base, cc: many },
      { ...base, bcc: many },
      { ...base, tags: [{ name: "has space", value: "ok" }] },
      { ...base, tags: [{ name: "ok", value: "a.b" }] },
      { ...base, tags: [{ name: "ok", value: "v".repeat(257) }] },
      { ...base, subject: "s".repeat(256) },
      { ...base, metadata: { userId: "user_123" } },
    ] satisfies EmailMessage[]) {
      await expect(adapter.send(invalid, context)).rejects.toBeInstanceOf(EmailValidationError);
    }

    expect(capture.calls).toHaveLength(0);
  });
});
