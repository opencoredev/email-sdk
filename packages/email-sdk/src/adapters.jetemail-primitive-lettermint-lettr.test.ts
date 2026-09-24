import { describe, expect, test } from "bun:test";
import { jetemail } from "./jetemail.js";
import { lettermint } from "./lettermint.js";
import { lettr } from "./lettr.js";
import { primitive } from "./primitive.js";
import {
  base64,
  context,
  jsonCapture,
  message,
  messageWithoutProviderSpecificFields,
  messageWithoutTagsOrMetadata,
} from "../test-support/adapter-fixtures.js";

describe("provider payloads", () => {
  test("JetEmail maps normalized fields and encodes attachments", async () => {
    const capture = jsonCapture({ id: "jet_123", response: "Message queued as jet_123" });

    const response = await jetemail({ apiKey: "key", fetch: capture.fetch }).send(
      messageWithoutTagsOrMetadata,
      context,
    );

    expect(response.id).toBe("jet_123");
    expect(response.id).toBe("jet_123");
    expect(capture.calls[0]?.url).toBe("https://api.jetemail.com/email");
    expect(capture.calls[0]?.headers.get("authorization")).toBe("Bearer key");
    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
    expect(capture.calls[0]?.json).toMatchObject({
      from: "Acme <hello@example.com>",
      to: ["Ada <ada@example.com>"],
      subject: "Welcome",
      text: "Hello",
      html: "<p>Hello</p>",
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      reply_to: ["reply@example.com"],
      headers: { "X-Test": "yes" },
    });
    expect(capture.calls[0]?.json.attachments[0]).toMatchObject({
      filename: "hello.txt",
      data: base64("hello"),
    });
  });

  test("JetEmail gives a per-send idempotency key precedence over static headers", async () => {
    const capture = jsonCapture({ id: "jet_123" });

    await jetemail({
      apiKey: "key",
      headers: { "idempotency-key": "static-key" },
      fetch: capture.fetch,
    }).send(messageWithoutTagsOrMetadata, context);

    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
  });

  test("JetEmail requires a from address with a display name", async () => {
    await expect(
      jetemail({ apiKey: "key", fetch: jsonCapture({ id: "jet_123" }).fetch }).send(
        { ...messageWithoutTagsOrMetadata, from: "hello@example.com" },
        context,
      ),
    ).rejects.toThrow("jetemail requires a from address with a display name");
  });

  test("JetEmail rejects more than 50 recipients", async () => {
    const recipients = Array.from({ length: 51 }, (_, index) => `user${index}@example.com`);

    await expect(
      jetemail({ apiKey: "key", fetch: jsonCapture({ id: "jet_123" }).fetch }).send(
        { ...messageWithoutTagsOrMetadata, to: recipients },
        context,
      ),
    ).rejects.toThrow("jetemail only supports 50 recipients per message");
  });

  test("Primitive maps normalized fields and encodes attachments", async () => {
    const capture = jsonCapture({ success: true, data: { id: "prim_123" } });

    const response = await primitive({ apiKey: "key", fetch: capture.fetch }).send(
      {
        ...message,
        to: { email: "ada@example.com", name: "Ada" },
        cc: undefined,
        bcc: undefined,
        replyTo: undefined,
        headers: undefined,
        tags: undefined,
        metadata: undefined,
      },
      context,
    );

    expect(response.id).toBe("prim_123");
    expect(response.id).toBe("prim_123");
    expect(capture.calls[0]?.url).toBe("https://api.primitive.dev/v1/send-mail");
    expect(capture.calls[0]?.headers.get("authorization")).toBe("Bearer key");
    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
    expect(capture.calls[0]?.json).toMatchObject({
      from: "Acme <hello@example.com>",
      to: "Ada <ada@example.com>",
      subject: "Welcome",
      body_text: "Hello",
      body_html: "<p>Hello</p>",
    });
    expect(capture.calls[0]?.json.attachments[0]).toMatchObject({
      filename: "hello.txt",
      content_base64: base64("hello"),
      content_type: "text/plain",
    });
  });

  test("Primitive rejects more than one recipient", async () => {
    await expect(
      primitive({
        apiKey: "key",
        fetch: jsonCapture({ success: true, data: { id: "prim_123" } }).fetch,
      }).send(
        {
          ...message,
          to: ["one@example.com", "two@example.com"],
          cc: undefined,
          bcc: undefined,
          replyTo: undefined,
          headers: undefined,
          tags: undefined,
          metadata: undefined,
        },
        context,
      ),
    ).rejects.toThrow("primitive only supports 1 recipient per message");
  });

  test("Primitive rejects a send with no recipient", async () => {
    await expect(
      primitive({
        apiKey: "key",
        fetch: jsonCapture({ success: true, data: { id: "prim_123" } }).fetch,
      }).send(
        {
          ...message,
          to: [],
          cc: undefined,
          bcc: undefined,
          replyTo: undefined,
          headers: undefined,
          tags: undefined,
          metadata: undefined,
        },
        context,
      ),
    ).rejects.toThrow("primitive requires one recipient");
  });

  test("Primitive keeps a per-send idempotency key over construction headers", async () => {
    const capture = jsonCapture({ success: true, data: { id: "prim_123" } });

    await primitive({
      apiKey: "key",
      headers: { "Idempotency-Key": "static-key" },
      fetch: capture.fetch,
    }).send(
      {
        ...message,
        to: "ada@example.com",
        cc: undefined,
        bcc: undefined,
        replyTo: undefined,
        headers: undefined,
        tags: undefined,
        metadata: undefined,
      },
      context,
    );

    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
  });

  test("Lettermint maps normalized fields and encodes attachments", async () => {
    const capture = jsonCapture({ message_id: "lm_123", status: "pending" });

    const response = await lettermint({ apiToken: "lm_token", fetch: capture.fetch }).send(
      message,
      context,
    );

    expect(response.id).toBe("lm_123");
    expect(response.id).toBe("lm_123");
    expect(capture.calls[0]?.url).toBe("https://api.lettermint.co/v1/send");
    expect(capture.calls[0]?.headers.get("x-lettermint-token")).toBe("lm_token");
    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
    expect(capture.calls[0]?.json).toMatchObject({
      from: "Acme <hello@example.com>",
      to: ["Ada <ada@example.com>"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      reply_to: ["reply@example.com"],
      subject: "Welcome",
      html: "<p>Hello</p>",
      text: "Hello",
      tag: "welcome",
      headers: { "X-Test": "yes" },
      metadata: { userId: "user_123" },
    });
    expect(capture.calls[0]?.json.attachments[0]).toEqual({
      filename: "hello.txt",
      content: base64("hello"),
      content_type: "text/plain",
    });
  });

  test("Lettermint forwards a configured route and a per-send idempotency key", async () => {
    const capture = jsonCapture({ message_id: "lm_123", status: "pending" });

    await lettermint({
      apiToken: "lm_token",
      route: "transactional",
      headers: { "Idempotency-Key": "static-key" },
      fetch: capture.fetch,
    }).send(messageWithoutProviderSpecificFields, context);

    expect(capture.calls[0]?.json.route).toBe("transactional");
    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
  });

  test("Lettr maps normalized fields and encodes attachments", async () => {
    const capture = jsonCapture({ data: { request_id: "lttr_123", accepted: 3, rejected: 0 } });

    const response = await lettr({ apiKey: "lttr_key", fetch: capture.fetch }).send(
      { ...message, to: "ada@example.com" },
      context,
    );

    expect(response.id).toBe("lttr_123");
    expect(response.accepted).toEqual(["ada@example.com", "cc@example.com", "bcc@example.com"]);
    expect(response.rejected).toEqual([]);
    expect(capture.calls[0]?.url).toBe("https://app.lettr.com/api/emails");
    expect(capture.calls[0]?.headers.get("authorization")).toBe("Bearer lttr_key");
    expect(capture.calls[0]?.json).toMatchObject({
      from: "hello@example.com",
      from_name: "Acme",
      to: ["ada@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      reply_to: "reply@example.com",
      subject: "Welcome",
      html: "<p>Hello</p>",
      text: "Hello",
      tag: "welcome",
      headers: { "X-Test": "yes" },
      metadata: { userId: "user_123" },
    });
    expect(capture.calls[0]?.json.attachments[0]).toEqual({
      name: "hello.txt",
      type: "text/plain",
      data: base64("hello"),
    });
  });

  test("Lettr treats 4xx failures as not sent", async () => {
    await expect(
      lettr({
        apiKey: "lttr_key",
        fetch: jsonCapture(
          {
            message: "The sender domain is not configured or approved for sending.",
            error_code: "unconfigured_domain",
          },
          { status: 400 },
        ).fetch,
      }).send({ ...message, to: "ada@example.com" }, context),
    ).rejects.toMatchObject({
      adapter: "lettr",
      status: 400,
      delivery: "not_sent",
      retryable: false,
    });
  });

  test("Lettr treats a zero-accept response as not sent", async () => {
    await expect(
      lettr({
        apiKey: "lttr_key",
        fetch: jsonCapture({ data: { request_id: "lttr_0", accepted: 0, rejected: 3 } }).fetch,
      }).send({ ...message, to: "ada@example.com" }, context),
    ).rejects.toMatchObject({
      adapter: "lettr",
      requestId: "lttr_0",
      delivery: "not_sent",
      retryable: false,
    });
  });

  test("Lettr treats partial recipient acceptance as unknown delivery", async () => {
    await expect(
      lettr({
        apiKey: "lttr_key",
        fetch: jsonCapture({ data: { request_id: "lttr_partial", accepted: 2, rejected: 1 } })
          .fetch,
      }).send({ ...message, to: "ada@example.com" }, context),
    ).rejects.toMatchObject({
      adapter: "lettr",
      requestId: "lttr_partial",
      delivery: "unknown",
      retryable: false,
      acceptedCount: 2,
      rejectedCount: 1,
    });
  });

  test("Lettr treats 5xx failures as retryable with unknown delivery", async () => {
    await expect(
      lettr({
        apiKey: "lttr_key",
        fetch: jsonCapture({ message: "Email transmission failed." }, { status: 502 }).fetch,
      }).send({ ...message, to: "ada@example.com" }, context),
    ).rejects.toMatchObject({
      adapter: "lettr",
      status: 502,
      delivery: "unknown",
      retryable: true,
    });
  });

  test("Lettr rejects malformed success responses", async () => {
    const adapters = [
      lettr({
        apiKey: "lttr_key",
        fetch: async () => new Response("not json", { status: 200 }),
      }),
      lettr({
        apiKey: "lttr_key",
        fetch: jsonCapture({ data: { request_id: "lttr_missing_counts" } }).fetch,
      }),
      lettr({
        apiKey: "lttr_key",
        fetch: jsonCapture({
          data: { request_id: "lttr_mismatched_counts", accepted: 1, rejected: 0 },
        }).fetch,
      }),
    ];

    for (const adapter of adapters) {
      await expect(
        adapter.send({ ...message, to: "ada@example.com" }, context),
      ).rejects.toMatchObject({
        adapter: "lettr",
        delivery: "unknown",
        retryable: false,
      });
    }
  });
});
