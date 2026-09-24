import { describe, expect, test } from "bun:test";
import { EmailValidationError } from "./errors.js";
import { mailgun } from "./mailgun.js";
import { ses } from "./ses.js";
import { unosend } from "./unosend.js";
import {
  base64,
  context,
  formCapture,
  jsonCapture,
  message,
  messageWithoutMetadata,
} from "../test-support/adapter-fixtures.js";

describe("provider payloads", () => {
  test("Unosend maps REST payloads and response IDs", async () => {
    const capture = jsonCapture({
      success: true,
      data: {
        id: "uno_123",
        status: "queued",
      },
    });

    const response = await unosend({
      apiKey: "un_test",
      fetch: capture.fetch,
    }).send(messageWithoutMetadata, context);

    expect(response.id).toBe("uno_123");
    expect(response.id).toBe("uno_123");
    expect(capture.calls[0]?.url).toBe("https://api.unosend.co/emails");
    expect(capture.calls[0]?.headers.get("authorization")).toBe("Bearer un_test");
    expect(capture.calls[0]?.json).toMatchObject({
      from: "Acme <hello@example.com>",
      to: ["Ada <ada@example.com>"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      reply_to: "reply@example.com",
      subject: "Welcome",
      text: "Hello",
      html: "<p>Hello</p>",
      headers: { "X-Test": "yes" },
      tags: [{ name: "kind", value: "welcome" }],
    });
    expect(capture.calls[0]?.json.attachments[0]).toEqual({
      filename: "hello.txt",
      content: base64("hello"),
      content_type: "text/plain",
    });
  });

  test("Unosend surfaces provider envelope errors", async () => {
    await expect(
      unosend({
        apiKey: "un_test",
        fetch: jsonCapture({
          success: false,
          error: {
            code: "domain_not_verified",
            message: "Sending domain is not verified.",
            status: 400,
          },
        }).fetch,
      }).send(messageWithoutMetadata, context),
    ).rejects.toThrow("unosend failed: Sending domain is not verified.");
  });

  test("SES signs and maps simple email payloads", async () => {
    const capture = jsonCapture({ MessageId: "ses_123" });

    const response = await ses({
      accessKeyId: "access",
      secretAccessKey: "secret",
      sessionToken: "session",
      region: "us-east-1",
      fetch: capture.fetch,
    }).send(messageWithoutMetadata, context);

    expect(response.id).toBe("ses_123");
    expect(capture.calls[0]?.url).toBe(
      "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails",
    );
    expect(capture.calls[0]?.headers.get("authorization")).toStartWith(
      "AWS4-HMAC-SHA256 Credential=access/",
    );
    expect(capture.calls[0]?.headers.has("host")).toBe(false);
    expect(capture.calls[0]?.headers.get("x-amz-security-token")).toBe("session");
    expect(capture.calls[0]?.json).toMatchObject({
      FromEmailAddress: "Acme <hello@example.com>",
      Destination: {
        ToAddresses: ["Ada <ada@example.com>"],
        CcAddresses: ["cc@example.com"],
        BccAddresses: ["bcc@example.com"],
      },
      ReplyToAddresses: ["reply@example.com"],
      EmailTags: [{ Name: "kind", Value: "welcome" }],
      Content: {
        Simple: {
          Subject: { Data: "Welcome", Charset: "UTF-8" },
          Body: {
            Text: { Data: "Hello", Charset: "UTF-8" },
            Html: { Data: "<p>Hello</p>", Charset: "UTF-8" },
          },
          Headers: [{ Name: "X-Test", Value: "yes" }],
        },
      },
    });
    expect(capture.calls[0]?.json.Content.Simple.Attachments[0]).toMatchObject({
      FileName: "hello.txt",
      RawContent: base64("hello"),
      ContentType: "text/plain",
      ContentTransferEncoding: "BASE64",
    });
  });

  test("Mailgun sends multipart form data with attachments", async () => {
    const capture = formCapture({ id: "<mailgun_123>" });

    const response = await mailgun({
      apiKey: "mg",
      domain: "mg.example.com",
      fetch: capture.fetch,
    }).send(message, context);

    expect(response.id).toBe("<mailgun_123>");
    expect(capture.calls[0]?.headers.has("content-type")).toBe(false);
    expect(capture.calls[0]?.form.get("from")).toBe("Acme <hello@example.com>");
    expect(capture.calls[0]?.form.getAll("to")).toEqual(["Ada <ada@example.com>"]);
    expect(capture.calls[0]?.form.get("h:X-Test")).toBe("yes");
    expect(capture.calls[0]?.files).toEqual([{ field: "attachment", name: "hello.txt" }]);
  });

  test("Mailgun batch sending attaches recipient-variables for one personalized call", async () => {
    const capture = formCapture({ id: "<mailgun_batch>" });
    const provider = mailgun({ apiKey: "mg", domain: "mg.example.com", fetch: capture.fetch });

    expect(provider.sendPersonalized).toBeDefined();
    await provider.sendPersonalized?.(
      {
        message: {
          from: "Acme <hello@acme.com>",
          subject: "Hi %recipient.name%",
          html: "<p>Hi %recipient.name%</p>",
        },
        recipients: [
          { to: "a@example.com", variables: { name: "Ada", id: "u_1" } },
          { to: "b@example.com", variables: { name: "Linus", id: "u_2" } },
        ],
      },
      context,
    );

    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0]?.form.getAll("to")).toEqual(["a@example.com", "b@example.com"]);
    expect(capture.calls[0]?.form.get("subject")).toBe("Hi %recipient.name%");
    expect(JSON.parse(String(capture.calls[0]?.form.get("recipient-variables")))).toEqual({
      "a@example.com": { name: "Ada", id: "u_1" },
      "b@example.com": { name: "Linus", id: "u_2" },
    });
  });

  test("Mailgun batch sending rejects more than 1000 recipients", async () => {
    const capture = formCapture({ id: "<mailgun_batch>" });
    const provider = mailgun({ apiKey: "mg", domain: "mg.example.com", fetch: capture.fetch });
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
