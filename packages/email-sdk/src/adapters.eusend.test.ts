import { describe, expect, test } from "bun:test";
import { EmailAdapterError, EmailValidationError } from "./errors.js";
import { eusend } from "./eusend.js";
import type { JsonValue } from "./internal/decode.js";
import type { EmailMessage } from "./types.js";
import { base64, context, jsonCapture, messageWithoutMetadata } from "../test-support/adapter-fixtures.js";

const created = { id: "4ef9a417-02e9-4d39-ad75-9611e0fcc33c" };

const base: EmailMessage = {
  from: "hello@example.com",
  to: "ada@example.com",
  subject: "Hi",
  html: "<p>Hi</p>",
};

const full: EmailMessage = {
  ...messageWithoutMetadata,
  to: "ada@example.com",
  tags: [{ name: "category", value: "welcome" }],
};

describe("provider payloads", () => {
  test("eusend maps normalized fields and encodes attachments", async () => {
    const capture = jsonCapture(created, { status: 201 });

    const response = await eusend({ apiKey: "eu_live_key", fetch: capture.fetch }).send(
      full,
      context,
    );

    expect(response).toMatchObject({ adapter: "eusend", id: created.id });
    expect(capture.calls[0]?.url).toBe("https://api.eusend.dev/emails");
    expect(capture.calls[0]?.headers.get("authorization")).toBe("Bearer eu_live_key");
    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
    expect(capture.calls[0]?.json).toEqual({
      from: "Acme <hello@example.com>",
      to: ["ada@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      reply_to: ["reply@example.com"],
      subject: "Welcome",
      html: "<p>Hello</p>",
      text: "Hello",
      headers: { "X-Test": "yes" },
      attachments: [
        { filename: "hello.txt", content: base64("hello"), content_type: "text/plain" },
      ],
      tags: [{ name: "category", value: "welcome" }],
    });
  });

  test("eusend sends sendAt as scheduled_at and inline attachments with their content id", async () => {
    const capture = jsonCapture(created, { status: 201 });

    await eusend({ apiKey: "eu_live_key", fetch: capture.fetch }).send(
      {
        ...base,
        sendAt: "2026-07-10T12:30:00.000Z",
        attachments: [
          { filename: "logo.png", content: "png", contentType: "image/png", contentId: "logo" },
        ],
      },
      context,
    );

    expect(capture.calls[0]?.json.scheduled_at).toBe("2026-07-10T12:30:00.000Z");
    expect(capture.calls[0]?.json.attachments).toEqual([
      { filename: "logo.png", content: base64("png"), content_type: "image/png", content_id: "logo" },
    ]);
  });

  test("eusend accepts the 200 an idempotent replay answers with", async () => {
    const response = await eusend({
      apiKey: "eu_live_key",
      fetch: jsonCapture(created, { status: 200 }).fetch,
    }).send(base, context);

    expect(response).toMatchObject({ adapter: "eusend", id: created.id });
  });

  test("eusend hashes idempotency keys longer than it stores", async () => {
    const send = async (idempotencyKey: string) => {
      const capture = jsonCapture(created, { status: 201 });

      await eusend({ apiKey: "eu_live_key", fetch: capture.fetch }).send(base, {
        ...context,
        idempotencyKey,
      });

      return capture.calls[0]?.headers.get("idempotency-key");
    };

    const exact = "k".repeat(255);
    expect(await send(exact)).toBe(exact);

    const long = `${"k".repeat(255)}:ada@example.com`;
    const first = await send(long);

    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await send(long)).toBe(first);
    expect(await send(`${"k".repeat(255)}:bob@example.com`)).not.toBe(first);
  });

  test("eusend gives a per-send idempotency key precedence over static headers", async () => {
    const capture = jsonCapture(created, { status: 201 });

    await eusend({
      apiKey: "eu_live_key",
      headers: { "idempotency-key": "static" },
      fetch: capture.fetch,
    }).send(base, context);

    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
  });

  test("eusend honours a custom base URL", async () => {
    const capture = jsonCapture(created, { status: 201 });

    await eusend({
      apiKey: "eu_live_key",
      baseUrl: "http://127.0.0.1:8787",
      fetch: capture.fetch,
    }).send(base, context);

    expect(capture.calls[0]?.url).toBe("http://127.0.0.1:8787/emails");
  });

  test.each([
    ["an empty body", ""],
    ["malformed JSON", "{"],
    ["a body without an id", JSON.stringify({})],
  ])("eusend reports a 201 with %s as an unknown outcome", async (_label, responseBody) => {
    const fetcher: typeof fetch = async () =>
      new Response(responseBody, { status: 201, headers: { "content-type": "application/json" } });

    const sent = eusend({ apiKey: "eu_live_key", fetch: fetcher }).send(base, context);

    await expect(sent).rejects.toBeInstanceOf(EmailAdapterError);
    await expect(sent).rejects.toMatchObject({ retryable: false, delivery: "unknown", status: 201 });
  });

  test("eusend surfaces its error text and code with delivery state", async () => {
    const send = (body: JsonValue, status: number) =>
      eusend({ apiKey: "eu_live_key", fetch: jsonCapture(body, { status }).fetch }).send(
        base,
        context,
      );

    await expect(
      send({ error: "Domain not verified", code: "DOMAIN_NOT_VERIFIED" }, 403),
    ).rejects.toMatchObject({
      message: "eusend failed with 403: Domain not verified (DOMAIN_NOT_VERIFIED)",
      status: 403,
      delivery: "not_sent",
      retryable: false,
    });
    await expect(
      send({ error: "All recipients are suppressed", code: "ALL_SUPPRESSED" }, 422),
    ).rejects.toMatchObject({ status: 422, delivery: "not_sent", retryable: false });
    await expect(
      send({ error: "Rate limit exceeded", code: "RATE_LIMIT_EXCEEDED" }, 429),
    ).rejects.toMatchObject({ status: 429, delivery: "not_sent", retryable: true });
    await expect(send({ error: "Request timeout" }, 408)).rejects.toMatchObject({
      status: 408,
      delivery: "unknown",
    });
    await expect(send({ error: "Internal error", code: "INTERNAL_ERROR" }, 500)).rejects.toMatchObject({
      status: 500,
      delivery: "unknown",
      retryable: true,
    });
  });

  test("eusend reports an empty 401 body", async () => {
    const fetcher: typeof fetch = async () => new Response("", { status: 401 });

    await expect(
      eusend({ apiKey: "bad", fetch: fetcher }).send(base, context),
    ).rejects.toMatchObject({ status: 401, delivery: "not_sent", retryable: false });
  });

  test("eusend rejects shapes its API cannot represent before fetch", async () => {
    const capture = jsonCapture(created, { status: 201 });
    const adapter = eusend({ apiKey: "eu_live_key", fetch: capture.fetch });

    const many = Array.from({ length: 51 }, (_, index) => `user${index}@example.com`);

    await expect(adapter.send({ ...base, to: many }, context)).rejects.toBeInstanceOf(
      EmailValidationError,
    );
    await expect(adapter.send({ ...base, bcc: many }, context)).rejects.toBeInstanceOf(
      EmailValidationError,
    );
    await expect(
      adapter.send({ ...base, to: { email: "ada@example.com", name: "Ada" } }, context),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(
      adapter.send({ ...base, replyTo: "Support <support@example.com>" }, context),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(
      adapter.send(
        {
          ...base,
          tags: Array.from({ length: 11 }, (_, index) => ({ name: `t${index}`, value: "v" })),
        },
        context,
      ),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(
      adapter.send({ ...base, tags: [{ name: "plan tier", value: "pro" }] }, context),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(
      adapter.send({ ...base, tags: [{ name: "plan", value: "x".repeat(257) }] }, context),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(
      adapter.send(
        {
          ...base,
          attachments: Array.from({ length: 21 }, (_, index) => ({
            filename: `f${index}.txt`,
            content: "x",
          })),
        },
        context,
      ),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(
      adapter.send(
        { ...base, attachments: [{ filename: "logo.png", content: "png", disposition: "inline" }] },
        context,
      ),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(adapter.send({ ...base, metadata: { userId: "u_1" } }, context)).rejects.toBeInstanceOf(
      EmailValidationError,
    );
    expect(capture.calls).toHaveLength(0);
  });
});
