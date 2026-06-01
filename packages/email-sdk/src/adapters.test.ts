import { describe, expect, test } from "bun:test";

import { brevo } from "./brevo.js";
import { cloudflare } from "./cloudflare.js";
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

const messageWithoutTagsOrMetadata: EmailMessage = {
  ...message,
  tags: undefined,
  metadata: undefined,
};

const cloudflareMessage: EmailMessage = {
  ...messageWithoutTagsOrMetadata,
  to: "ada@example.com",
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

  test("Cloudflare surfaces HTTP error details", async () => {
    await expect(
      cloudflare({
        apiToken: "cf_token",
        accountId: "account_123",
        fetch: jsonCapture(
          {
            success: false,
            errors: [{ code: 10001, message: "Authentication failed." }],
            result: null,
          },
          { status: 401 },
        ).fetch,
      }).send(cloudflareMessage, context),
    ).rejects.toThrow("Authentication failed.");
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

  test("Mailtrap maps the current transactional API schema", async () => {
    const capture = jsonCapture({ message_ids: ["mt_123"] });

    const response = await mailtrap({ apiKey: "key", fetch: capture.fetch }).send(message, context);

    expect(response.id).toBe("mt_123");
    expect(response.messageId).toBe("mt_123");
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
      scaleway({
        secretKey: "secret",
        projectId: "project",
        fetch: jsonCapture({ id: "scale_123" }).fetch,
      }).send(
        {
          ...messageWithoutProviderSpecificFields,
          headers: { "Reply-To": "other@example.com" },
          replyTo: "reply@example.com",
        },
        context,
      ),
    ).rejects.toThrow("scaleway cannot set replyTo");

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
      cloudflare({
        apiToken: "token",
        accountId: "account",
        fetch: jsonCapture({ success: true }).fetch,
      }).send({ ...limitedMessage, metadata: { id: "nope" } }, context),
    ).rejects.toThrow("cloudflare does not support");
  });

  test("empty optional field containers do not fail narrow adapters", async () => {
    const emptyOptionals = {
      ...message,
      headers: {},
      metadata: {},
      tags: [],
      attachments: undefined,
      cc: undefined,
      bcc: undefined,
      replyTo: undefined,
    };

    const response = await loops({
      apiKey: "key",
      transactionalId: "tx",
      fetch: jsonCapture({ id: "loop_123" }).fetch,
    }).send(emptyOptionals, context);

    expect(response.id).toBe("loop_123");
  });

  test("adapters reject values they can only partially represent", async () => {
    await expect(
      postmark({
        serverToken: "server",
        fetch: jsonCapture({ MessageID: "postmark_123" }).fetch,
      }).send(
        {
          ...message,
          tags: [
            { name: "kind", value: "welcome" },
            { name: "plan", value: "pro" },
          ],
        },
        context,
      ),
    ).rejects.toThrow("postmark only supports 1 tag per message");

    await expect(
      mailtrap({ apiKey: "key", fetch: jsonCapture({ message_id: "mt_123" }).fetch }).send(
        {
          ...messageWithoutReplyToOrMetadata,
          tags: [
            { name: "kind", value: "welcome" },
            { name: "plan", value: "pro" },
          ],
        },
        context,
      ),
    ).rejects.toThrow("mailtrap only supports 1 tag per message");

    await expect(
      brevo({ apiKey: "key", fetch: jsonCapture({ messageId: "brevo_123" }).fetch }).send(
        {
          ...message,
          replyTo: ["reply@example.com", "support@example.com"],
        },
        context,
      ),
    ).rejects.toThrow("brevo only supports 1 replyTo per message");

    await expect(
      mailersend({ apiKey: "key", fetch: jsonCapture({ message_id: "ms_123" }).fetch }).send(
        {
          ...messageWithoutMetadata,
          replyTo: ["reply@example.com", "support@example.com"],
        },
        context,
      ),
    ).rejects.toThrow("mailersend only supports 1 replyTo per message");

    await expect(
      cloudflare({
        apiToken: "token",
        accountId: "account",
        fetch: jsonCapture({ success: true }).fetch,
      }).send(
        {
          ...messageWithoutProviderSpecificFields,
          to: "ada@example.com",
          replyTo: ["reply@example.com", "support@example.com"],
        },
        context,
      ),
    ).rejects.toThrow("cloudflare only supports 1 replyTo per message");

    await expect(
      cloudflare({
        apiToken: "token",
        accountId: "account",
        fetch: jsonCapture({ success: true }).fetch,
      }).send(messageWithoutProviderSpecificFields, context),
    ).rejects.toThrow("cloudflare recipient fields only support plain email addresses");
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
