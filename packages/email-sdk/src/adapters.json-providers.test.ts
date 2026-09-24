import { describe, expect, test } from "bun:test";
import { brevo } from "./brevo.js";
import { cloudflare } from "./cloudflare.js";
import { EmailValidationError } from "./errors.js";
import { lettermint } from "./lettermint.js";
import { lettr } from "./lettr.js";
import { loops } from "./loops.js";
import { mailchimp } from "./mailchimp.js";
import { mailersend } from "./mailersend.js";
import { mailpace } from "./mailpace.js";
import { mailtrap } from "./mailtrap.js";
import { plunk } from "./plunk.js";
import { scaleway } from "./scaleway.js";
import { sendgrid } from "./sendgrid.js";
import type { EmailAdapter, EmailMessage } from "./types.js";
import { unosend } from "./unosend.js";
import { zeptomail } from "./zeptomail.js";
import {
  base64,
  context,
  jsonCapture,
  message,
  messageWithoutMetadata,
  messageWithoutProviderSpecificFields,
  messageWithoutReplyTo,
} from "../test-support/adapter-fixtures.js";

describe("provider payloads", () => {
  test("JSON adapters expose fetch injection and stable core fields", async () => {
    const cases = [
      {
        name: "mailersend",
        provider: mailersend({
          apiKey: "key",
          fetch: jsonCapture(
            {},
            {
              headers: {
                "x-message-id": "ms_123",
              },
            },
          ).fetch,
        }),
        message: messageWithoutMetadata,
      },
      {
        name: "brevo",
        provider: brevo({ apiKey: "key", fetch: jsonCapture({ messageId: "brevo_123" }).fetch }),
      },
      {
        name: "mailchimp",
        provider: mailchimp({ apiKey: "key", fetch: jsonCapture([{ _id: "mc_123" }]).fetch }),
        message: messageWithoutReplyTo,
      },
      {
        name: "mailtrap",
        provider: mailtrap({
          apiKey: "key",
          fetch: jsonCapture({ message_ids: ["mt_123"] }).fetch,
        }),
      },
      {
        name: "cloudflare",
        provider: cloudflare({
          apiToken: "token",
          accountId: "account",
          fetch: jsonCapture({ success: true, result: { delivered: ["ada@example.com"] } }).fetch,
        }),
        message: {
          ...messageWithoutProviderSpecificFields,
          to: "ada@example.com",
        },
      },
      {
        name: "unosend",
        provider: unosend({
          apiKey: "key",
          fetch: jsonCapture({ success: true, data: { id: "uno_123" } }).fetch,
        }),
        message: messageWithoutMetadata,
      },
      {
        name: "zeptomail",
        provider: zeptomail({
          token: "token",
          fetch: jsonCapture({ request_id: "zoho_123" }).fetch,
        }),
        message: messageWithoutProviderSpecificFields,
      },
      {
        name: "lettermint",
        provider: lettermint({
          apiToken: "token",
          fetch: jsonCapture({ message_id: "lm_123", status: "pending" }).fetch,
        }),
      },
      {
        name: "lettr",
        provider: lettr({
          apiKey: "token",
          fetch: jsonCapture({ data: { request_id: "lttr_123", accepted: 3, rejected: 0 } }).fetch,
        }),
        message: {
          ...message,
          to: "ada@example.com",
        },
      },
    ];

    for (const item of cases) {
      const response = await item.provider.send(item.message ?? message, context);
      expect(response.adapter).toBe(item.name);
    }
  });

  test("Mailtrap maps the current transactional API schema", async () => {
    const capture = jsonCapture({ message_ids: ["mt_123"] });

    const response = await mailtrap({ apiKey: "key", fetch: capture.fetch }).send(message, context);

    expect(response.id).toBe("mt_123");
    expect(response.id).toBe("mt_123");
    expect(capture.calls[0]?.headers.get("api-token")).toBe("key");
    expect(capture.calls[0]?.json).toMatchObject({
      from: { email: "hello@example.com", name: "Acme" },
      to: [{ email: "ada@example.com", name: "Ada" }],
      cc: [{ email: "cc@example.com" }],
      bcc: [{ email: "bcc@example.com" }],
      reply_to: { email: "reply@example.com" },
      custom_variables: { userId: "user_123" },
      category: "welcome",
    });
    expect(capture.calls[0]?.json.attachments[0]).toMatchObject({
      filename: "hello.txt",
      content: base64("hello"),
      type: "text/plain",
    });
  });

  test("Scaleway maps the REST API address, header, and attachment schema", async () => {
    const capture = jsonCapture({ id: "scale_123" });

    const response = await scaleway({
      secretKey: "secret",
      projectId: "project",
      fetch: capture.fetch,
    }).send({ ...messageWithoutMetadata, tags: undefined }, context);

    expect(response.id).toBe("scale_123");
    expect(capture.calls[0]?.json).toMatchObject({
      project_id: "project",
      from: { email: "hello@example.com", name: "Acme" },
      to: [{ email: "ada@example.com", name: "Ada" }],
      cc: [{ email: "cc@example.com" }],
      bcc: [{ email: "bcc@example.com" }],
      subject: "Welcome",
      additional_headers: [
        { key: "X-Test", value: "yes" },
        { key: "Reply-To", value: "reply@example.com" },
      ],
    });
    expect(capture.calls[0]?.json.attachments[0]).toEqual({
      name: "hello.txt",
      content: base64("hello"),
      type: "text/plain",
    });
  });

  test("Plunk maps current send fields and wrapped response IDs", async () => {
    const capture = jsonCapture({
      success: true,
      data: {
        emails: [
          {
            contact: { id: "cnt_123", email: "ada@example.com" },
            email: "plunk_123",
          },
        ],
      },
    });

    const response = await plunk({ apiKey: "key", fetch: capture.fetch }).send(
      {
        ...message,
        cc: undefined,
        bcc: undefined,
        tags: undefined,
        replyTo: { email: "reply@example.com", name: "Support" },
      },
      context,
    );

    expect(response.id).toBe("plunk_123");
    expect(capture.calls[0]?.json).toMatchObject({
      to: [{ email: "ada@example.com", name: "Ada" }],
      from: { email: "hello@example.com", name: "Acme" },
      headers: { "X-Test": "yes" },
      reply: "reply@example.com",
      data: { userId: "user_123" },
    });
    expect(capture.calls[0]?.json.attachments[0]).toEqual({
      filename: "hello.txt",
      content: base64("hello"),
      contentType: "text/plain",
    });
  });

  test("Loops requires the transactional email ID provider option", () => {
    expect(() =>
      loops({
        apiKey: "key",
        transactionalId: "",
        fetch: jsonCapture({ success: true }).fetch,
      }),
    ).toThrow("loops requires a transactionalId");
  });

  test("Loops maps transactional data variables and attachments", async () => {
    const capture = jsonCapture({ id: "loop_123" });

    const response = await loops({
      apiKey: "key",
      transactionalId: "tx",
      fetch: capture.fetch,
    }).send(
      {
        ...message,
        cc: undefined,
        bcc: undefined,
        replyTo: undefined,
        headers: undefined,
        tags: undefined,
        attachments: [
          {
            filename: "hello.bin",
            content: "hello",
          },
        ],
      },
      context,
    );

    expect(response.id).toBe("loop_123");
    expect(capture.calls[0]?.json).toMatchObject({
      transactionalId: "tx",
      email: "Ada <ada@example.com>",
      addToAudience: false,
      dataVariables: {
        subject: "Welcome",
        html: "<p>Hello</p>",
        text: "Hello",
        from: "Acme <hello@example.com>",
        userId: "user_123",
      },
    });
    expect(capture.calls[0]?.json.attachments[0]).toEqual({
      filename: "hello.bin",
      contentType: "application/octet-stream",
      data: base64("hello"),
    });
  });

  test("Loops rejects multiple recipients with a typed validation error before fetch", async () => {
    const capture = jsonCapture({ id: "loop_123" });

    await expect(
      loops({ apiKey: "key", transactionalId: "tx", fetch: capture.fetch }).send(
        {
          ...message,
          to: ["ada@example.com", "grace@example.com"],
          cc: undefined,
          bcc: undefined,
          replyTo: undefined,
          headers: undefined,
          tags: undefined,
        },
        context,
      ),
    ).rejects.toBeInstanceOf(EmailValidationError);
    expect(capture.calls).toHaveLength(0);
  });

  test("MailPace maps positive payload fields", async () => {
    const capture = jsonCapture({ id: "mailpace_123" });

    const response = await mailpace({ apiKey: "key", fetch: capture.fetch }).send(
      {
        ...message,
        headers: undefined,
        attachments: undefined,
        tags: undefined,
        metadata: undefined,
      },
      context,
    );

    expect(response.id).toBe("mailpace_123");
    expect(capture.calls[0]?.json).toEqual({
      from: "Acme <hello@example.com>",
      to: "Ada <ada@example.com>",
      cc: "cc@example.com",
      bcc: "bcc@example.com",
      replyto: "reply@example.com",
      subject: "Welcome",
      htmlbody: "<p>Hello</p>",
      textbody: "Hello",
    });
  });

  test("direct JSON adapter send validates baseline and adapter rules before fetch", async () => {
    const loopUnsupported = jsonCapture({ id: "loop_123" });
    const sendgridRepeated = jsonCapture({}, { headers: { "x-message-id": "sg_123" } });
    const resendMissing = jsonCapture({ id: "res_123" });
    const resendEmpty = jsonCapture({ id: "res_123" });
    const loopLimit = jsonCapture({ id: "loop_123" });

    const cases: Array<{
      name: string;
      adapter: EmailAdapter<string>;
      capture: ReturnType<typeof jsonCapture>;
      invalid: EmailMessage;
    }> = [
      {
        name: "unsupported fields",
        capture: loopUnsupported,
        adapter: loops({ apiKey: "key", transactionalId: "tx", fetch: loopUnsupported.fetch }),
        invalid: {
          ...message,
          cc: "cc@example.com",
          replyTo: undefined,
          headers: undefined,
          tags: undefined,
        },
      },
      {
        name: "repeated headers",
        capture: sendgridRepeated,
        adapter: sendgrid({ apiKey: "sg", fetch: sendgridRepeated.fetch }),
        invalid: {
          ...message,
          metadata: undefined,
          headers: [
            { name: "X-Test", value: "one" },
            { name: "x-test", value: "two" },
          ],
        },
      },
      {
        name: "missing recipient",
        capture: resendMissing,
        adapter: sendgrid({ apiKey: "sg", fetch: resendMissing.fetch }),
        invalid: { ...message, metadata: undefined, to: [] },
      },
      {
        name: "empty subject",
        capture: resendEmpty,
        adapter: sendgrid({ apiKey: "sg", fetch: resendEmpty.fetch }),
        invalid: { ...message, metadata: undefined, subject: "" },
      },
      {
        name: "adapter recipient limit",
        capture: loopLimit,
        adapter: loops({ apiKey: "key", transactionalId: "tx", fetch: loopLimit.fetch }),
        invalid: {
          ...message,
          to: ["ada@example.com", "grace@example.com"],
          cc: undefined,
          bcc: undefined,
          replyTo: undefined,
          headers: undefined,
          tags: undefined,
        },
      },
    ];

    for (const testCase of cases) {
      await expect(
        testCase.adapter.send(testCase.invalid, context),
        testCase.name,
      ).rejects.toBeInstanceOf(EmailValidationError);
      expect(testCase.capture.calls, testCase.name).toHaveLength(0);
    }
  });

  test("unsupported optional recipient arrays are absent when empty and rejected before fetch when populated", async () => {
    const accepted = jsonCapture({ id: "loop_123" });
    await expect(
      loops({ apiKey: "key", transactionalId: "tx", fetch: accepted.fetch }).send(
        {
          ...message,
          cc: [],
          bcc: [],
          replyTo: [],
          headers: undefined,
          tags: undefined,
        },
        context,
      ),
    ).resolves.toMatchObject({ id: "loop_123" });
    expect(accepted.calls).toHaveLength(1);

    for (const field of ["cc", "bcc", "replyTo"] as const) {
      const rejected = jsonCapture({ id: "loop_123" });
      await expect(
        loops({ apiKey: "key", transactionalId: "tx", fetch: rejected.fetch }).send(
          {
            ...message,
            cc: undefined,
            bcc: undefined,
            replyTo: undefined,
            headers: undefined,
            tags: undefined,
            [field]: ["extra@example.com"],
          },
          context,
        ),
      ).rejects.toBeInstanceOf(EmailValidationError);
      expect(rejected.calls, field).toHaveLength(0);
    }
  });

  test("one-replyTo validation agrees for validate and direct send", async () => {
    const cases = [
      brevo({ apiKey: "key", fetch: jsonCapture({ messageId: "brevo_123" }).fetch }),
      mailersend({ apiKey: "key", fetch: jsonCapture({}).fetch }),
      mailtrap({ apiKey: "key", fetch: jsonCapture({ message_ids: ["mt_123"] }).fetch }),
      plunk({ apiKey: "key", fetch: jsonCapture({ success: true, data: { emails: [] } }).fetch }),
    ];

    const invalid = {
      ...message,
      replyTo: ["reply@example.com", "support@example.com"],
      metadata: undefined,
    } satisfies EmailMessage;

    for (const adapter of cases) {
      expect(() => adapter.validate?.(invalid)).toThrow(EmailValidationError);
      await expect(adapter.send(invalid, context)).rejects.toBeInstanceOf(EmailValidationError);
    }
  });
});
