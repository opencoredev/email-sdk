import { describe, expect, test } from "bun:test";
import { EmailAdapterError, EmailValidationError } from "./errors.js";
import { helo } from "./helo.js";
import type { JsonValue } from "./internal/decode.js";
import type { EmailMessage } from "./types.js";
import { base64, context, jsonCapture, message } from "../test-support/adapter-fixtures.js";

const accepted = { status: "accepted", messageId: "helo_123", suppressions: [] };

const base: EmailMessage = {
  from: "hello@example.com",
  to: "ada@example.com",
  subject: "Hi",
  html: "<p>Hi</p>",
};

describe("provider payloads", () => {
  test("Helo maps normalized fields and encodes attachments", async () => {
    const capture = jsonCapture(accepted);

    const response = await helo({ apiKey: "helo_key", fetch: capture.fetch }).send(
      message,
      context,
    );

    expect(response).toMatchObject({ adapter: "helo", id: "helo_123" });
    expect(capture.calls[0]?.url).toBe("https://api.helohq.com/send/transactional");
    expect(capture.calls[0]?.headers.get("authorization")).toBe("Bearer helo_key");
    expect(capture.calls[0]?.headers.get("x-helo-idempotency-key")).toBe("idem_123");
    expect(capture.calls[0]?.headers.has("x-helo-channel-id")).toBe(false);
    expect(capture.calls[0]?.json).toEqual({
      from: { email: "hello@example.com", name: "Acme" },
      to: [{ email: "ada@example.com", name: "Ada" }],
      cc: [{ email: "cc@example.com" }],
      bcc: [{ email: "bcc@example.com" }],
      replyTo: [{ email: "reply@example.com" }],
      subject: "Welcome",
      html: "<p>Hello</p>",
      text: "Hello",
      attachments: [
        {
          content: base64("hello"),
          fileName: "hello.txt",
          contentType: "text/plain",
          disposition: "attachment",
        },
      ],
      tags: ["welcome"],
      headers: { "X-Test": "yes" },
      metadata: { userId: "user_123" },
    });
  });

  test("Helo sends the channel header and stringifies metadata", async () => {
    const capture = jsonCapture(accepted);

    await helo({ apiKey: "helo_key", channelId: "chan_1", fetch: capture.fetch }).send(
      { ...base, metadata: { count: 3, vip: true, note: null } },
      context,
    );

    expect(capture.calls[0]?.headers.get("x-helo-channel-id")).toBe("chan_1");
    expect(capture.calls[0]?.json.metadata).toEqual({ count: "3", vip: "true", note: "" });
    expect(capture.calls[0]?.json.from).toEqual({ email: "hello@example.com" });
  });

  test("Helo marks attachments with a content id as inline", async () => {
    const capture = jsonCapture(accepted);

    await helo({ apiKey: "helo_key", fetch: capture.fetch }).send(
      {
        ...base,
        attachments: [
          { filename: "logo.png", content: "png", contentType: "image/png", contentId: "logo" },
        ],
      },
      context,
    );

    expect(capture.calls[0]?.json.attachments).toEqual([
      {
        content: base64("png"),
        fileName: "logo.png",
        contentType: "image/png",
        contentId: "logo",
        disposition: "inline",
      },
    ]);
  });

  test("Helo hashes idempotency keys longer than 36 characters", async () => {
    const send = async (idempotencyKey: string) => {
      const capture = jsonCapture(accepted);

      await helo({ apiKey: "helo_key", fetch: capture.fetch }).send(base, {
        ...context,
        idempotencyKey,
      });

      return capture.calls[0]?.headers.get("x-helo-idempotency-key");
    };

    const long = "order_1234567890:ada.lovelace@example.com";
    const first = await send(long);

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(await send(long)).toBe(first);
    expect(await send(`${long}x`)).not.toBe(first);
  });

  test("Helo gives a per-send idempotency key precedence over static headers", async () => {
    const capture = jsonCapture(accepted);

    await helo({
      apiKey: "helo_key",
      headers: { "x-helo-idempotency-key": "static" },
      fetch: capture.fetch,
    }).send(base, context);

    expect(capture.calls[0]?.headers.get("x-helo-idempotency-key")).toBe("idem_123");
  });

  test.each([
    ["an empty body", ""],
    ["malformed JSON", "{"],
    ["a body without a message id", JSON.stringify({ status: "accepted" })],
  ])("Helo reports a 200 with %s as an unknown outcome", async (_label, responseBody) => {
    const fetcher: typeof fetch = async () =>
      new Response(responseBody, { status: 200, headers: { "content-type": "application/json" } });

    const sent = helo({ apiKey: "helo_key", fetch: fetcher }).send(base, context);

    await expect(sent).rejects.toBeInstanceOf(EmailAdapterError);
    await expect(sent).rejects.toMatchObject({ retryable: false, delivery: "unknown", status: 200 });
  });

  test("Helo treats a failed send as not sent and never retryable", async () => {
    await expect(
      helo({
        apiKey: "helo_key",
        fetch: jsonCapture({
          status: "failed",
          errorCode: "recipient_suppressed",
          errorMessage: "Recipient is suppressed",
        }).fetch,
      }).send(base, context),
    ).rejects.toMatchObject({
      adapter: "helo",
      delivery: "not_sent",
      retryable: false,
      message: "Helo failed the send: Recipient is suppressed (recipient_suppressed).",
    });
  });

  test("Helo surfaces problem details with delivery state", async () => {
    const send = (body: JsonValue, status: number) =>
      helo({ apiKey: "helo_key", fetch: jsonCapture(body, { status }).fetch }).send(
        base,
        context,
      );

    await expect(
      send(
        {
          title: "Validation failed",
          detail: "The request body is invalid.",
          code: "validation_failed",
          errors: { "/to/0/email": [{ message: "Must be a valid email", code: "format" }] },
        },
        422,
      ),
    ).rejects.toMatchObject({
      message:
        "Helo failed with 422: The request body is invalid. /to/0/email: Must be a valid email (validation_failed)",
      status: 422,
      delivery: "not_sent",
      retryable: false,
    });
    await expect(
      send({ detail: "Channel is required.", code: "invalid_channel" }, 422),
    ).rejects.toMatchObject({
      message: "Helo failed with 422: Channel is required. (invalid_channel)",
    });
    await expect(send({ detail: "Busy", code: "idempotency_conflict" }, 409)).rejects.toMatchObject(
      { status: 409, delivery: "unknown" },
    );
    await expect(send({ title: "Unavailable" }, 503)).rejects.toMatchObject({
      status: 503,
      delivery: "unknown",
      retryable: true,
    });
  });

  test("Helo reports an empty 401 body", async () => {
    const fetcher: typeof fetch = async () => new Response("", { status: 401 });

    await expect(
      helo({ apiKey: "bad", fetch: fetcher }).send(base, context),
    ).rejects.toMatchObject({ status: 401, delivery: "not_sent", retryable: false });
  });

  test("Helo rejects shapes its API cannot represent before fetch", async () => {
    const capture = jsonCapture(accepted);
    const adapter = helo({ apiKey: "helo_key", fetch: capture.fetch });

    const many = Array.from({ length: 51 }, (_, index) => `user${index}@example.com`);

    await expect(adapter.send({ ...base, to: many }, context)).rejects.toBeInstanceOf(
      EmailValidationError,
    );
    await expect(
      adapter.send(
        {
          ...base,
          tags: Array.from({ length: 6 }, (_, index) => ({ name: "t", value: `v${index}` })),
        },
        context,
      ),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(
      adapter.send({ ...base, tags: [{ name: "t", value: "x".repeat(101) }] }, context),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(
      adapter.send(
        {
          ...base,
          metadata: Object.fromEntries(Array.from({ length: 11 }, (_, index) => [`k${index}`, "v"])),
        },
        context,
      ),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(
      adapter.send({ ...base, metadata: { key: "v".repeat(101) } }, context),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(adapter.send({ ...base, subject: "s".repeat(257) }, context)).rejects.toBeInstanceOf(
      EmailValidationError,
    );
    await expect(
      adapter.send({ ...base, sendAt: "2026-07-10T12:30:00.000Z" }, context),
    ).rejects.toBeInstanceOf(EmailValidationError);
    expect(capture.calls).toHaveLength(0);
  });
});
