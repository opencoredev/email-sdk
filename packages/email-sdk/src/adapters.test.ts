import { describe, expect, test } from "bun:test";

import { brevo } from "./brevo.js";
import { loops } from "./loops.js";
import { mailchimp } from "./mailchimp.js";
import { mailersend } from "./mailersend.js";
import { mailgun } from "./mailgun.js";
import { mailpace } from "./mailpace.js";
import { mailtrap } from "./mailtrap.js";
import { plunk } from "./plunk.js";
import { postmark } from "./postmark.js";
import { resend } from "./resend.js";
import { scaleway } from "./scaleway.js";
import { ses } from "./ses.js";
import { sendgrid } from "./sendgrid.js";
import { sparkpost } from "./sparkpost.js";
import type { EmailMessage, EmailProviderContext } from "./types.js";
import { zeptomail } from "./zeptomail.js";

const context: EmailProviderContext = {
  attempt: 1,
  idempotencyKey: "idem_123",
};

const message: EmailMessage = {
  from: "Acme <hello@example.com>",
  to: [{ email: "ada@example.com", name: "Ada" }],
  cc: "cc@example.com",
  bcc: "bcc@example.com",
  replyTo: "reply@example.com",
  subject: "Welcome",
  text: "Hello",
  html: "<p>Hello</p>",
  headers: {
    "X-Test": "yes",
  },
  attachments: [
    {
      filename: "hello.txt",
      content: "hello",
      contentType: "text/plain",
    },
  ],
  tags: [{ name: "kind", value: "welcome" }],
  metadata: {
    userId: "user_123",
  },
};

const messageWithoutProviderSpecificFields: EmailMessage = {
  ...message,
  headers: undefined,
  tags: undefined,
  metadata: undefined,
};

const messageWithoutMetadata: EmailMessage = {
  ...message,
  metadata: undefined,
};

const messageWithoutReplyTo: EmailMessage = {
  ...message,
  replyTo: undefined,
};

const messageWithoutReplyToOrMetadata: EmailMessage = {
  ...message,
  replyTo: undefined,
  metadata: undefined,
};

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

  test("Postmark maps metadata, headers, and attachments", async () => {
    const capture = jsonCapture({ MessageID: "postmark_123", To: "ada@example.com" });

    const response = await postmark({
      serverToken: "server",
      messageStream: "outbound",
      fetch: capture.fetch,
    }).send(message, context);

    expect(response.messageId).toBe("postmark_123");
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

  test("SES signs and maps simple email payloads", async () => {
    const capture = jsonCapture({ MessageId: "ses_123" });

    const response = await ses({
      accessKeyId: "access",
      secretAccessKey: "secret",
      sessionToken: "session",
      region: "us-east-1",
      fetch: capture.fetch,
    }).send(messageWithoutMetadata, context);

    expect(response.messageId).toBe("ses_123");
    expect(capture.calls[0]?.url).toBe(
      "https://email.us-east-1.amazonaws.com/v2/email/outbound-emails",
    );
    expect(capture.calls[0]?.headers.get("authorization")).toStartWith(
      "AWS4-HMAC-SHA256 Credential=access/",
    );
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

  test("JSON adapters expose fetch injection and stable core fields", async () => {
    const cases = [
      {
        name: "mailersend",
        provider: mailersend({ apiKey: "key", fetch: jsonCapture({ message_id: "ms_123" }).fetch }),
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
        provider: mailtrap({ apiKey: "key", fetch: jsonCapture({ message_id: "mt_123" }).fetch }),
        message: messageWithoutReplyToOrMetadata,
      },
      {
        name: "zeptomail",
        provider: zeptomail({
          token: "token",
          fetch: jsonCapture({ request_id: "zoho_123" }).fetch,
        }),
        message: messageWithoutProviderSpecificFields,
      },
    ];

    for (const item of cases) {
      const response = await item.provider.send(item.message ?? message, context);
      expect(response.provider).toBe(item.name);
    }
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

  test("limited adapters reject fields they cannot send instead of dropping them", async () => {
    const limitedMessage = {
      ...message,
      attachments: undefined,
    };

    await expect(
      loops({
        apiKey: "key",
        transactionalId: "tx",
        fetch: jsonCapture({ id: "loop_123" }).fetch,
      }).send({ ...limitedMessage, cc: "cc@example.com" }, context),
    ).rejects.toThrow("loops does not support");

    await expect(
      plunk({ apiKey: "key", fetch: jsonCapture({ id: "plunk_123" }).fetch }).send(
        { ...limitedMessage, cc: "cc@example.com" },
        context,
      ),
    ).rejects.toThrow("plunk does not support");

    await expect(
      mailpace({ apiKey: "key", fetch: jsonCapture({ id: "mailpace_123" }).fetch }).send(
        { ...limitedMessage, headers: { "X-Test": "yes" } },
        context,
      ),
    ).rejects.toThrow("mailpace does not support");

    await expect(
      sparkpost({ apiKey: "key", fetch: jsonCapture({ results: { id: "spark_123" } }).fetch }).send(
        { ...limitedMessage, cc: "cc@example.com" },
        context,
      ),
    ).rejects.toThrow("sparkpost does not support");

    await expect(
      scaleway({
        secretKey: "secret",
        projectId: "project",
        fetch: jsonCapture({ id: "scale_123" }).fetch,
      }).send({ ...limitedMessage, metadata: { id: "nope" } }, context),
    ).rejects.toThrow("scaleway does not support");

    await expect(
      resend({ apiKey: "key", fetch: jsonCapture({ id: "res_123" }).fetch }).send(
        { ...limitedMessage, metadata: { id: "nope" } },
        context,
      ),
    ).rejects.toThrow("resend does not support");

    await expect(
      ses({
        accessKeyId: "access",
        secretAccessKey: "secret",
        region: "us-east-1",
        fetch: jsonCapture({ MessageId: "ses_123" }).fetch,
      }).send({ ...limitedMessage, metadata: { id: "nope" } }, context),
    ).rejects.toThrow("ses does not support");

    await expect(
      mailersend({ apiKey: "key", fetch: jsonCapture({ id: "ms_123" }).fetch }).send(
        { ...limitedMessage, metadata: { id: "nope" } },
        context,
      ),
    ).rejects.toThrow("mailersend does not support");

    await expect(
      mailchimp({ apiKey: "key", fetch: jsonCapture([{ _id: "mc_123" }]).fetch }).send(
        { ...limitedMessage, replyTo: "reply@example.com" },
        context,
      ),
    ).rejects.toThrow("mailchimp does not support");

    await expect(
      mailtrap({ apiKey: "key", fetch: jsonCapture({ id: "mt_123" }).fetch }).send(
        { ...limitedMessage, replyTo: "reply@example.com" },
        context,
      ),
    ).rejects.toThrow("mailtrap does not support");
  });
});

function jsonCapture(body: unknown, init?: ResponseInit) {
  const calls: Array<{
    url: string;
    headers: Headers;
    json: any;
  }> = [];
  const fetch: typeof globalThis.fetch = async (input, requestInit) => {
    calls.push({
      url: String(input),
      headers: new Headers(requestInit?.headers),
      json: JSON.parse(String(requestInit?.body)),
    });

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        ...Object.fromEntries(new Headers(init?.headers).entries()),
      },
      ...init,
    });
  };

  return { calls, fetch };
}

function formCapture(body: unknown) {
  const calls: Array<{
    url: string;
    headers: Headers;
    form: FormData;
    files: Array<{ field: string; name: string }>;
  }> = [];
  const fetch: typeof globalThis.fetch = async (input, requestInit) => {
    const form = requestInit?.body as FormData;
    calls.push({
      url: String(input),
      headers: new Headers(requestInit?.headers),
      form,
      files: Array.from(form.entries())
        .filter(([, value]) => typeof value !== "string")
        .map(([field, value]) => ({ field, name: (value as File).name })),
    });

    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
      },
    });
  };

  return { calls, fetch };
}

function base64(value: string) {
  return Buffer.from(value).toString("base64");
}
