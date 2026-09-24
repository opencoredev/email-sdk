import { describe, expect, test } from "bun:test";
import { EmailValidationError } from "./errors.js";
import { iterable } from "./iterable.js";
import { sequenzy } from "./sequenzy.js";
import { zeptomail } from "./zeptomail.js";
import {
  base64,
  context,
  jsonCapture,
  message,
  messageWithoutProviderSpecificFields,
} from "../test-support/adapter-fixtures.js";

describe("provider payloads", () => {
  test("Sequenzy maps direct transactional sends and reserved metadata", async () => {
    const capture = jsonCapture({
      success: true,
      jobId: "job_123",
      to: "Ada <ada@example.com>",
      transactional: {
        id: "txn_123",
        slug: "welcome",
      },
    });

    const response = await sequenzy({ apiKey: "key", fetch: capture.fetch }).send(
      {
        ...message,
        cc: undefined,
        bcc: undefined,
        headers: undefined,
        tags: undefined,
        metadata: {
          sequenzyPreview: "Preview text",
          subscriberExternalId: "user_123",
          plan: "pro",
        },
      },
      context,
    );

    expect(response.id).toBe("job_123");
    expect(response.accepted).toEqual(["Ada <ada@example.com>"]);
    expect(capture.calls[0]?.url).toBe("https://api.sequenzy.com/api/v1/transactional/send");
    expect(capture.calls[0]?.headers.get("authorization")).toBe("Bearer key");
    expect(capture.calls[0]?.json).toMatchObject({
      to: "Ada <ada@example.com>",
      from: "Acme <hello@example.com>",
      replyTo: "reply@example.com",
      subject: "Welcome",
      body: "<p>Hello</p>",
      preview: "Preview text",
      subscriberExternalId: "user_123",
      variables: {
        plan: "pro",
      },
    });
    expect(capture.calls[0]?.json.attachments[0]).toEqual({
      filename: "hello.txt",
      content: base64("hello"),
    });
  });

  test("Sequenzy maps template slug sends and URL attachments", async () => {
    const capture = jsonCapture({ success: true, jobId: "job_123" });

    await sequenzy({ apiKey: "key", fetch: capture.fetch }).send(
      {
        ...message,
        cc: undefined,
        bcc: undefined,
        replyTo: undefined,
        headers: undefined,
        tags: undefined,
        attachments: [
          {
            filename: "invoice.pdf",
            path: "https://example.com/invoice.pdf",
          },
        ],
        metadata: {
          sequenzySlug: "welcome",
          NAME: "Ada",
        },
      },
      context,
    );

    expect(capture.calls[0]?.json).toMatchObject({
      slug: "welcome",
      variables: {
        NAME: "Ada",
      },
      attachments: [
        {
          filename: "invoice.pdf",
          path: "https://example.com/invoice.pdf",
        },
      ],
    });
    expect(capture.calls[0]?.json.subject).toBeUndefined();
    expect(capture.calls[0]?.json.body).toBeUndefined();
  });

  test("Sequenzy keeps generic slug and preview metadata as variables", async () => {
    const capture = jsonCapture({ success: true, jobId: "job_123" });

    await sequenzy({ apiKey: "key", fetch: capture.fetch }).send(
      {
        ...message,
        cc: undefined,
        bcc: undefined,
        replyTo: undefined,
        headers: undefined,
        tags: undefined,
        attachments: undefined,
        metadata: {
          slug: "pricing-page-cta",
          preview: "experiment-a",
        },
      },
      context,
    );

    expect(capture.calls[0]?.json).not.toHaveProperty("slug");
    expect(capture.calls[0]?.json).not.toHaveProperty("preview");
    expect(capture.calls[0]?.json.variables).toEqual({
      preview: "experiment-a",
      slug: "pricing-page-cta",
    });
  });

  test("Sequenzy omits attachments when the message has none", async () => {
    const capture = jsonCapture({ success: true, jobId: "job_123" });

    await sequenzy({ apiKey: "key", fetch: capture.fetch }).send(
      {
        ...message,
        cc: undefined,
        bcc: undefined,
        replyTo: undefined,
        headers: undefined,
        tags: undefined,
        attachments: undefined,
      },
      context,
    );

    expect(capture.calls[0]?.json).not.toHaveProperty("attachments");
  });

  test("Sequenzy surfaces provider envelope errors", async () => {
    await expect(
      sequenzy({
        apiKey: "key",
        fetch: jsonCapture({ success: false, error: "Template disabled" }).fetch,
      }).send(
        {
          ...message,
          cc: undefined,
          bcc: undefined,
          headers: undefined,
          tags: undefined,
        },
        context,
      ),
    ).rejects.toThrow("Template disabled");
  });

  test("Sequenzy surfaces error bodies without success flags", async () => {
    await expect(
      sequenzy({
        apiKey: "key",
        fetch: jsonCapture({ error: "Unauthorized" }).fetch,
      }).send(
        {
          ...message,
          cc: undefined,
          bcc: undefined,
          headers: undefined,
          tags: undefined,
        },
        context,
      ),
    ).rejects.toThrow("Unauthorized");
  });

  test("Iterable maps campaign target sends", async () => {
    const capture = jsonCapture({ code: "Success", msg: "Email sent" });

    const response = await iterable({
      apiKey: "iterable_key",
      campaignId: 123,
      allowRepeatMarketingSends: false,
      sendAt: "2026-06-03 12:00:00",
      dataFields: (emailMessage) => ({
        plan: emailMessage.metadata?.plan,
      }),
      fetch: capture.fetch,
    }).send(
      {
        ...message,
        cc: undefined,
        bcc: undefined,
        replyTo: undefined,
        headers: undefined,
        tags: undefined,
        attachments: undefined,
        metadata: {
          plan: "pro",
        },
      },
      context,
    );

    expect(response.adapter).toBe("iterable");
    expect(response.raw).toEqual({ code: "Success", msg: "Email sent" });
    expect(capture.calls[0]?.url).toBe("https://api.iterable.com/api/email/target");
    expect(capture.calls[0]?.headers.get("api-key")).toBe("iterable_key");
    expect(capture.calls[0]?.json).toMatchObject({
      campaignId: 123,
      recipientEmail: "ada@example.com",
      allowRepeatMarketingSends: false,
      sendAt: "2026-06-03 12:00:00",
      dataFields: {
        plan: "pro",
        subject: "Welcome",
        html: "<p>Hello</p>",
        text: "Hello",
        from: "Acme <hello@example.com>",
      },
      metadata: {
        plan: "pro",
      },
    });
  });

  test("Iterable requires a numeric campaign ID", () => {
    expect(() =>
      iterable({
        apiKey: "key",
        campaignId: Number.NaN,
        fetch: jsonCapture({ msg: "iterable_123" }).fetch,
      }),
    ).toThrow("iterable requires a numeric campaignId");

    expect(() =>
      iterable({
        apiKey: "key",
        campaignId: Number.NaN,
        fetch: jsonCapture({ msg: "iterable_123" }).fetch,
      }),
    ).toThrow(EmailValidationError);
  });

  test("Iterable rejects direct sends without a recipient", async () => {
    await expect(
      iterable({
        apiKey: "key",
        campaignId: 123,
        fetch: jsonCapture({ code: "Success", msg: "Email sent" }).fetch,
      }).send(
        {
          ...message,
          to: [],
          cc: undefined,
          bcc: undefined,
          replyTo: undefined,
          headers: undefined,
          tags: undefined,
          attachments: undefined,
        },
        context,
      ),
    ).rejects.toThrow(EmailValidationError);
  });

  test("ZeptoMail uses the official address shape", async () => {
    const capture = jsonCapture({ request_id: "zoho_123" });

    await zeptomail({ token: "token", fetch: capture.fetch }).send(
      messageWithoutProviderSpecificFields,
      context,
    );

    expect(capture.calls[0]?.json.from).toEqual({
      address: "hello@example.com",
      name: "Acme",
    });
    expect(capture.calls[0]?.json.to).toEqual([
      {
        email_address: {
          address: "ada@example.com",
          name: "Ada",
        },
      },
    ]);
  });
});
