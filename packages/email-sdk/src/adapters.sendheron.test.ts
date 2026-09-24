import { describe, expect, test } from "bun:test";
import { EmailAdapterError, EmailValidationError } from "./errors.js";
import { sendheron } from "./sendheron.js";
import type { JsonValue } from "./internal/decode.js";
import {
  base64,
  context,
  jsonCapture,
  messageWithoutTagsOrMetadata,
} from "../test-support/adapter-fixtures.js";

describe("provider payloads", () => {
  test("SendHeron maps normalized fields and encodes attachments", async () => {
    const capture = jsonCapture(
      { id: "heron_123", status: "sent", errorMessage: null, providerMessageId: "prov_1" },
      { status: 201 },
    );

    const response = await sendheron({ apiKey: "sh_key", fetch: capture.fetch }).send(
      { ...messageWithoutTagsOrMetadata, to: "ada@example.com" },
      context,
    );

    expect(response).toMatchObject({ adapter: "sendheron", id: "heron_123" });
    expect(capture.calls[0]?.url).toBe("https://api.sendheron.com/api/v1/emails/send");
    expect(capture.calls[0]?.headers.get("authorization")).toBe("Bearer sh_key");
    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
    expect(capture.calls[0]?.json).toEqual({
      to: "ada@example.com",
      subject: "Welcome",
      html: "<p>Hello</p>",
      from: "hello@example.com",
      fromName: "Acme",
      replyTo: "reply@example.com",
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      headers: { "X-Test": "yes" },
      attachments: [{ content: base64("hello"), filename: "hello.txt", type: "text/plain" }],
    });
  });

  test("SendHeron escapes text-only messages into html", async () => {
    const capture = jsonCapture({ id: "heron_text", status: "sent" }, { status: 201 });

    await sendheron({ apiKey: "sh_key", fetch: capture.fetch }).send(
      { from: "hello@example.com", to: "ada@example.com", subject: "Hi", text: "a < b & c" },
      context,
    );

    expect(capture.calls[0]?.json.html).toBe(
      '<pre style="white-space:pre-wrap;font-family:inherit">a &lt; b &amp; c</pre>',
    );
    expect(capture.calls[0]?.json.fromName).toBeUndefined();
  });

  test("SendHeron gives a per-send idempotency key precedence over static headers", async () => {
    const capture = jsonCapture({ id: "heron_idem", status: "sent" }, { status: 201 });

    await sendheron({
      apiKey: "sh_key",
      headers: { "Idempotency-Key": "static" },
      fetch: capture.fetch,
    }).send(
      { from: "hello@example.com", to: "ada@example.com", subject: "Hi", html: "<p>Hi</p>" },
      context,
    );

    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
  });

  test.each([
    ["an empty body", ""],
    ["malformed JSON", "{"],
    ["a body without an id", JSON.stringify({ status: "sent" })],
  ])("SendHeron reports a 201 with %s as an unknown outcome", async (_label, responseBody) => {
    const fetcher: typeof fetch = async () =>
      new Response(responseBody, { status: 201, headers: { "content-type": "application/json" } });

    const sent = sendheron({ apiKey: "sh_key", fetch: fetcher }).send(
      { from: "hello@example.com", to: "ada@example.com", subject: "Hi", html: "<p>Hi</p>" },
      context,
    );

    await expect(sent).rejects.toBeInstanceOf(EmailAdapterError);
    await expect(sent).rejects.toMatchObject({ retryable: false, delivery: "unknown", status: 201 });
  });

  test("SendHeron treats a suppressed send as not sent and never retryable", async () => {
    await expect(
      sendheron({
        apiKey: "sh_key",
        fetch: jsonCapture(
          { id: "heron_supp", status: "suppressed", errorMessage: "HARD_SUPPRESSED" },
          { status: 201 },
        ).fetch,
      }).send(
        { from: "hello@example.com", to: "ada@example.com", subject: "Hi", html: "<p>Hi</p>" },
        context,
      ),
    ).rejects.toMatchObject({
      adapter: "sendheron",
      delivery: "not_sent",
      retryable: false,
      message: expect.stringContaining("HARD_SUPPRESSED"),
    });
  });

  test("SendHeron surfaces stable error keys with delivery state", async () => {
    const send = (body: JsonValue, status: number) =>
      sendheron({ apiKey: "sh_key", fetch: jsonCapture(body, { status }).fetch }).send(
        { from: "hello@example.com", to: "ada@example.com", subject: "Hi", html: "<p>Hi</p>" },
        context,
      );

    await expect(
      send(
        {
          statusCode: 401,
          message: "apiKeys.invalidToken",
          error: "UNAUTHORIZED",
          description: "Unauthorized",
        },
        401,
      ),
    ).rejects.toMatchObject({
      message: "SendHeron failed with 401: Unauthorized (apiKeys.invalidToken)",
      status: 401,
      delivery: "not_sent",
      retryable: false,
    });
    await expect(
      send(
        { statusCode: 503, message: "emailSending.sendFailed", error: "SERVICE_UNAVAILABLE" },
        503,
      ),
    ).rejects.toMatchObject({ status: 503, delivery: "not_sent", retryable: true });
    await expect(
      send({ statusCode: 409, message: "emailSending.idempotencyConflict" }, 409),
    ).rejects.toMatchObject({ status: 409, delivery: "unknown" });
  });

  test("SendHeron rejects shapes its API cannot represent before fetch", async () => {
    const capture = jsonCapture({ id: "heron_never", status: "sent" }, { status: 201 });
    const adapter = sendheron({ apiKey: "sh_key", fetch: capture.fetch });

    const base: EmailMessage = {
      from: "hello@example.com",
      to: "ada@example.com",
      subject: "Hi",
      html: "<p>Hi</p>",
    };

    await expect(
      adapter.send({ ...base, to: ["ada@example.com", "bob@example.com"] }, context),
    ).rejects.toBeInstanceOf(EmailValidationError);
    await expect(adapter.send({ ...base, to: "Ada <ada@example.com>" }, context)).rejects.toThrow(
      "sendheron recipient and replyTo fields only support plain email addresses.",
    );
    await expect(
      adapter.send(
        {
          ...base,
          sendAt: "2026-07-10T12:30:00.000Z",
          attachments: [{ filename: "a.txt", content: "a", contentType: "text/plain" }],
        },
        context,
      ),
    ).rejects.toThrow("sendheron cannot schedule a message with attachments.");
    await expect(
      adapter.send(
        {
          ...base,
          attachments: [
            { filename: "a.bin", content: "a", contentType: "application/octet-stream" },
          ],
        },
        context,
      ),
    ).rejects.toThrow("sendheron requires an attachment contentType from its allowlist");
    await expect(
      adapter.send(
        {
          ...base,
          attachments: [
            { filename: "logo.png", content: "a", contentType: "image/png", contentId: "logo" },
          ],
        },
        context,
      ),
    ).rejects.toThrow("sendheron does not support inline attachments.");
    expect(capture.calls).toHaveLength(0);
  });

  test("SendHeron maps sendAt to its native scheduling field", async () => {
    const sendAt = new Date("2026-07-10T12:30:00.000Z");

    const sendheronCapture = jsonCapture(
      { id: "heron_sched", sendAt: "2026-07-10T12:30:00.000Z", status: "SCHEDULED" },
      { status: 201 },
    );

    const scheduled = await sendheron({ apiKey: "sh_key", fetch: sendheronCapture.fetch }).send(
      {
        from: "hello@example.com",
        to: "ada@example.com",
        subject: "Hi",
        html: "<p>Hi</p>",
        sendAt,
      },
      context,
    );

    expect(sendheronCapture.calls[0]?.json.sendAt).toBe("2026-07-10T12:30:00.000Z");
    expect(scheduled.id).toBe("heron_sched");
  });
});
