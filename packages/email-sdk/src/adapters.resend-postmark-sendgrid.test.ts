import { describe, expect, test } from "bun:test";
import { EmailValidationError } from "./errors.js";
import { postmark } from "./postmark.js";
import { resend } from "./resend.js";
import { sendgrid } from "./sendgrid.js";
import {
  base64,
  context,
  jsonCapture,
  message,
  messageWithoutMetadata,
} from "../test-support/adapter-fixtures.js";

describe("provider payloads", () => {
  test("Resend maps normalized fields and encodes attachments", async () => {
    const capture = jsonCapture({ id: "res_123" });

    const response = await resend({ apiKey: "key", fetch: capture.fetch }).send(
      messageWithoutMetadata,
      context,
    );

    expect(response.id).toBe("res_123");
    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
    expect(capture.calls[0]?.json).toMatchObject({
      from: "Acme <hello@example.com>",
      to: ["Ada <ada@example.com>"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      reply_to: ["reply@example.com"],
      tags: [{ name: "kind", value: "welcome" }],
    });
    expect(capture.calls[0]?.json.attachments[0].content).toBe(base64("hello"));
  });

  test("Resend gives a per-send idempotency key precedence over static headers", async () => {
    const capture = jsonCapture({ id: "res_123" });

    await resend({
      apiKey: "key",
      headers: { "idempotency-key": "static-key" },
      fetch: capture.fetch,
    }).send(messageWithoutMetadata, context);

    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
  });

  test("Postmark maps metadata, headers, and attachments", async () => {
    const capture = jsonCapture({ MessageID: "postmark_123", To: "ada@example.com" });

    const response = await postmark({
      serverToken: "server",
      messageStream: "outbound",
      fetch: capture.fetch,
    }).send(message, context);

    expect(response.id).toBe("postmark_123");
    expect(capture.calls[0]?.json).toMatchObject({
      From: "Acme <hello@example.com>",
      To: "Ada <ada@example.com>",
      Cc: "cc@example.com",
      Bcc: "bcc@example.com",
      ReplyTo: "reply@example.com",
      MessageStream: "outbound",
      Metadata: { userId: "user_123" },
      Tag: "kind:welcome",
    });
    expect(capture.calls[0]?.json.Headers).toEqual([{ Name: "X-Test", Value: "yes" }]);
    expect(capture.calls[0]?.json.Attachments[0].Content).toBe(base64("hello"));
  });

  test("SendGrid maps message ID from the response header", async () => {
    const capture = jsonCapture(
      {},
      {
        headers: {
          "x-message-id": "sg_123",
        },
      },
    );

    const response = await sendgrid({ apiKey: "sg", fetch: capture.fetch }).send(message, context);

    expect(response.id).toBe("sg_123");
    expect(capture.calls[0]?.json.personalizations[0]).toMatchObject({
      to: [{ email: "ada@example.com", name: "Ada" }],
      cc: [{ email: "cc@example.com" }],
      bcc: [{ email: "bcc@example.com" }],
      headers: { "X-Test": "yes" },
      custom_args: { userId: "user_123" },
    });
    expect(capture.calls[0]?.json.attachments[0]).toMatchObject({
      filename: "hello.txt",
      content: base64("hello"),
      type: "text/plain",
    });
  });

  test("SendGrid batch sending emits one personalization with substitutions per recipient", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_batch" } });
    const provider = sendgrid({ apiKey: "sg", fetch: capture.fetch });

    expect(provider.sendPersonalized).toBeDefined();

    const response = await provider.sendPersonalized?.(
      {
        message: {
          from: "Acme <hello@acme.com>",
          subject: "Hi %recipient.name%",
          html: "<p>Hi %recipient.name%</p>",
        },
        recipients: [
          { to: "a@example.com", variables: { name: "Ada", id: "u_1" } },
          {
            to: { email: "b@example.com", name: "Linus" },
            variables: { name: "Linus", id: "u_2" },
          },
        ],
      },
      context,
    );

    expect(response?.id).toBe("sg_batch");
    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0]?.json.personalizations).toEqual([
      {
        to: [{ email: "a@example.com" }],
        substitutions: { "%recipient.name%": "Ada", "%recipient.id%": "u_1" },
      },
      {
        to: [{ email: "b@example.com", name: "Linus" }],
        substitutions: { "%recipient.name%": "Linus", "%recipient.id%": "u_2" },
      },
    ]);
    expect(capture.calls[0]?.json.subject).toBe("Hi %recipient.name%");
  });

  test("SendGrid batch sending rejects more than 1000 recipients", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_batch" } });
    const provider = sendgrid({ apiKey: "sg", fetch: capture.fetch });
    const to = Array.from({ length: 1001 }, (_, index) => `user${index}@example.com`);

    await expect(
      provider.sendPersonalized?.(
        {
          message: {
            from: "Acme <hello@acme.com>",
            subject: "Hi %recipient.name%",
            text: "Hi %recipient.name%",
          },
          recipients: to.map((address) => ({
            to: address,
            variables: { name: "Ada" },
          })),
        },
        context,
      ),
    ).rejects.toThrow(EmailValidationError);
    expect(capture.calls).toHaveLength(0);
  });
});
