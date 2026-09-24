import { describe, expect, test } from "bun:test";
import { cloudflare } from "./cloudflare.js";
import { EmailAdapterError, EmailValidationError } from "./errors.js";
import {
  base64,
  cloudflareMessage,
  context,
  jsonCapture,
} from "../test-support/adapter-fixtures.js";
import { rejectionOf } from "../test-support/assertions.js";

describe("provider payloads", () => {
  test("Cloudflare maps REST payloads and delivery status", async () => {
    const capture = jsonCapture({
      success: true,
      errors: [],
      messages: [],
      result: {
        delivered: ["ada@example.com"],
        queued: ["cc@example.com"],
        permanent_bounces: ["bcc@example.com"],
      },
    });

    const response = await cloudflare({
      apiToken: "cf_token",
      accountId: "account_123",
      fetch: capture.fetch,
    }).send(cloudflareMessage, context);

    expect(response.accepted).toEqual(["ada@example.com", "cc@example.com"]);
    expect(response.rejected).toEqual(["bcc@example.com"]);
    expect(capture.calls[0]?.url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/account_123/email/sending/send",
    );
    expect(capture.calls[0]?.headers.get("authorization")).toBe("Bearer cf_token");
    expect(capture.calls[0]?.json).toMatchObject({
      from: { address: "hello@example.com", name: "Acme" },
      to: ["ada@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      reply_to: "reply@example.com",
      subject: "Welcome",
      text: "Hello",
      html: "<p>Hello</p>",
      headers: { "X-Test": "yes" },
    });
    expect(capture.calls[0]?.json.attachments[0]).toMatchObject({
      filename: "hello.txt",
      content: base64("hello"),
      type: "text/plain",
      disposition: "attachment",
    });
  });

  test("Cloudflare accepts object recipients without display names", async () => {
    const capture = jsonCapture({ success: true, result: { delivered: ["ada@example.com"] } });

    await cloudflare({ apiToken: "cf_token", accountId: "account_123", fetch: capture.fetch }).send(
      {
        ...cloudflareMessage,
        to: { email: "ada@example.com" },
        cc: [{ email: "cc@example.com" }],
        bcc: { email: "bcc@example.com" },
      },
      context,
    );

    expect(capture.calls[0]?.json).toMatchObject({
      to: ["ada@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
    });
  });

  test("Cloudflare rejects recipient display names before fetch", async () => {
    const capture = jsonCapture({ success: true });

    await expect(
      cloudflare({ apiToken: "cf_token", accountId: "account_123", fetch: capture.fetch }).send(
        { ...cloudflareMessage, to: { email: "ada@example.com", name: "Ada" } },
        context,
      ),
    ).rejects.toBeInstanceOf(EmailValidationError);
    expect(capture.calls).toHaveLength(0);
  });

  test("Cloudflare surfaces provider envelope errors", async () => {
    await expect(
      cloudflare({
        apiToken: "cf_token",
        accountId: "account_123",
        fetch: jsonCapture({
          success: false,
          errors: [{ code: 10000, message: "Recipient is not verified." }],
          result: null,
        }).fetch,
      }).send(cloudflareMessage, context),
    ).rejects.toThrow("Recipient is not verified.");
  });

  test("Cloudflare rejects unexpected success envelopes", async () => {
    await expect(
      cloudflare({
        apiToken: "cf_token",
        accountId: "account_123",
        fetch: jsonCapture({ result: { delivered: ["ada@example.com"] } }).fetch,
      }).send(cloudflareMessage, context),
    ).rejects.toThrow("cloudflare failed.");
  });

  test("Cloudflare sends via Worker binding", async () => {
    let sentPayload: any;

    const binding = {
      async send(payload: any) {
        sentPayload = payload;

        return { messageId: "msg_123" };
      },
    };

    const adapter = cloudflare({ binding });
    expect(adapter.raw).toEqual({ binding });

    const response = await adapter.send(
      {
        ...cloudflareMessage,
        to: "ada@example.com",
        cc: "cc@example.com",
        bcc: "bcc@example.com",
        replyTo: { email: "reply@example.com", name: "Support" },
        attachments: [
          {
            filename: "hello.txt",
            content: "hello",
            contentType: "text/plain",
            contentId: "hello-file",
          },
        ],
      },
      context,
    );

    expect(response.id).toBe("msg_123");
    expect(response.accepted).toEqual(["ada@example.com", "cc@example.com", "bcc@example.com"]);
    expect(sentPayload).toEqual({
      from: { email: "hello@example.com", name: "Acme" },
      to: ["ada@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      replyTo: { email: "reply@example.com", name: "Support" },
      subject: "Welcome",
      text: "Hello",
      html: "<p>Hello</p>",
      headers: { "X-Test": "yes" },
      attachments: [
        {
          content: base64("hello"),
          filename: "hello.txt",
          type: "text/plain",
          disposition: "inline",
          contentId: "hello-file",
        },
      ],
    });
  });

  test("Cloudflare binding accepts a successful send without a result", async () => {
    const binding = {
      async send() {},
    };

    const response = await cloudflare({ binding }).send(cloudflareMessage, context);

    expect(response).toEqual({
      adapter: "cloudflare",
      id: undefined,
      accepted: ["ada@example.com", "cc@example.com", "bcc@example.com"],
      raw: undefined,
    });
  });

  test("Cloudflare binding surfaces send errors", async () => {
    const binding = {
      async send() {
        throw new Error("Binding send failed");
      },
    };

    await expect(cloudflare({ binding }).send(cloudflareMessage, context)).rejects.toThrow(
      "cloudflare failed: Binding send failed",
    );
  });

  test("Cloudflare binding marks transient service errors as retryable", async () => {
    const binding = {
      async send() {
        throw Object.assign(new Error("Rate limit exceeded"), {
          code: "E_RATE_LIMIT_EXCEEDED",
        });
      },
    };

    const error = await rejectionOf(
      cloudflare({ binding }).send(cloudflareMessage, context),
      EmailAdapterError,
    );

    expect(error).toBeInstanceOf(EmailAdapterError);
    expect(error.retryable).toBe(true);
  });

  test("Cloudflare exposes a safe HTTP error without the raw response body", async () => {
    const error = await rejectionOf(
      cloudflare({
        apiToken: "cf_token",
        accountId: "account_123",
        fetch: jsonCapture(
          {
            success: false,
            errors: [{ code: 10001, message: "Authentication failed.", secret: "raw-token" }],
            result: null,
          },
          { status: 401 },
        ).fetch,
      }).send(cloudflareMessage, context),
      EmailAdapterError,
    );

    expect(error).toBeInstanceOf(EmailAdapterError);
    expect(error.message).toContain("Authentication failed.");
    expect(error.cause).toBeUndefined();
    expect("details" in error).toBe(false);
  });
});
