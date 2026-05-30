import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";

import { mailgunInbound } from "./inbound-mailgun.js";
import { postmarkInbound } from "./inbound-postmark.js";
import { resendInbound } from "./inbound-resend.js";
import { sendgridInbound } from "./inbound-sendgrid.js";

describe("inbound webhook adapters", () => {
  test("Resend normalizes inbound email payloads", async () => {
    const payload = {
      type: "email.received",
      data: {
        email_id: "email_123",
        message_id: "<resend@example.com>",
        from: "Ada <ada@example.com>",
        to: ["team@example.com"],
        cc: ["Grace <grace@example.com>"],
        subject: "Hello",
        text: "Plain",
        html: "<p>Plain</p>",
        headers: {
          "In-Reply-To": "<parent@example.com>",
          References: "<root@example.com> <parent@example.com>",
        },
        attachments: [
          {
            filename: "hello.txt",
            content_type: "text/plain",
            size: 5,
            url: "https://example.com/hello.txt",
          },
        ],
      },
    };

    const email = await resendInbound().parse(payload, {});

    expect(email).toMatchObject({
      id: "email_123",
      provider: "resend",
      from: { email: "ada@example.com", name: "Ada" },
      to: [{ email: "team@example.com" }],
      subject: "Hello",
      text: "Plain",
      html: "<p>Plain</p>",
      messageId: "<resend@example.com>",
      inReplyTo: "<parent@example.com>",
    });
    expect(email.references).toEqual(["<root@example.com>", "<parent@example.com>"]);
    expect(email.attachments[0]?.filename).toBe("hello.txt");
    expect(email.raw).toBe(payload);
  });

  test("Mailgun Routes form-style payload normalizes common fields", async () => {
    const payload = {
      from: "Ada <ada@example.com>",
      recipient: "inbound@example.com",
      subject: "Route",
      "body-plain": "Text body",
      "body-html": "<p>Text body</p>",
      "message-headers": JSON.stringify([
        ["Message-ID", "<mailgun@example.com>"],
        ["In-Reply-To", "<parent@example.com>"],
        ["References", "<root@example.com> <parent@example.com>"],
      ]),
      attachments: [
        {
          filename: "invoice.pdf",
          contentType: "application/pdf",
          size: 42,
        },
      ],
    };

    const email = await mailgunInbound().parse(payload, {});

    expect(email).toMatchObject({
      provider: "mailgun",
      from: { email: "ada@example.com", name: "Ada" },
      to: [{ email: "inbound@example.com" }],
      subject: "Route",
      text: "Text body",
      html: "<p>Text body</p>",
      messageId: "<mailgun@example.com>",
      inReplyTo: "<parent@example.com>",
    });
    expect(email.attachments[0]?.filename).toBe("invoice.pdf");
    expect(email.raw).toBe(payload);
  });

  test("Postmark inbound webhook normalizes provider fields", async () => {
    const payload = {
      MessageID: "postmark_123",
      FromFull: { Email: "ada@example.com", Name: "Ada" },
      ToFull: [{ Email: "inbound@example.com", Name: "Inbound" }],
      CcFull: [{ Email: "cc@example.com" }],
      Subject: "Postmark",
      TextBody: "Text",
      HtmlBody: "<p>Text</p>",
      Headers: [
        { Name: "Message-ID", Value: "<postmark@example.com>" },
        { Name: "References", Value: "<root@example.com>" },
      ],
      Attachments: [
        {
          Name: "file.txt",
          ContentType: "text/plain",
          ContentLength: 4,
          Content: "dGVzdA==",
        },
      ],
    };

    const email = await postmarkInbound().parse(payload, {});

    expect(email).toMatchObject({
      id: "postmark_123",
      provider: "postmark",
      from: { email: "ada@example.com", name: "Ada" },
      to: [{ email: "inbound@example.com", name: "Inbound" }],
      cc: [{ email: "cc@example.com" }],
      subject: "Postmark",
      text: "Text",
      html: "<p>Text</p>",
      messageId: "<postmark@example.com>",
    });
    expect(email.headers["Message-ID"]).toBe("<postmark@example.com>");
    expect(email.attachments[0]?.filename).toBe("file.txt");
    expect(email.raw).toBe(payload);
  });

  test("SendGrid Inbound Parse payload normalizes form fields", async () => {
    const payload = {
      envelope: JSON.stringify({ to: ["inbound@example.com"], from: "bounce@example.com" }),
      from: "Ada <ada@example.com>",
      to: "Inbound <inbound@example.com>",
      cc: "cc@example.com",
      subject: "SendGrid",
      text: "Text",
      html: "<p>Text</p>",
      headers: [
        ["Message-ID", "<sendgrid@example.com>"],
        ["In-Reply-To", "<parent@example.com>"],
      ],
      attachments: [
        {
          filename: "sg.txt",
          contentType: "text/plain",
        },
      ],
    };

    const email = await sendgridInbound().parse(payload, {});

    expect(email).toMatchObject({
      provider: "sendgrid",
      from: { email: "ada@example.com", name: "Ada" },
      to: [{ email: "inbound@example.com", name: "Inbound" }],
      cc: [{ email: "cc@example.com" }],
      subject: "SendGrid",
      text: "Text",
      html: "<p>Text</p>",
      messageId: "<sendgrid@example.com>",
      inReplyTo: "<parent@example.com>",
    });
    expect(email.attachments[0]?.filename).toBe("sg.txt");
    expect(email.raw).toBe(payload);
  });

  test("Resend verifies Svix-style signatures when a webhook secret is configured", async () => {
    const payload = JSON.stringify({ type: "email.received", data: { from: "a@example.com" } });
    const id = "msg_123";
    const timestamp = "1767225600";
    const secret = `whsec_${Buffer.from("secret").toString("base64")}`;
    const signature = createHmac("sha256", "secret")
      .update(`${id}.${timestamp}.${payload}`)
      .digest("base64");
    const request = new Request("https://example.com/webhook", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "svix-id": id,
        "svix-timestamp": timestamp,
        "svix-signature": `v1,${signature}`,
      },
      body: payload,
    });

    await expect(resendInbound({ webhookSecret: secret }).verify?.(request)).resolves.toBe(true);
  });

  test("Mailgun verifies timestamp and token signatures when configured", async () => {
    const timestamp = "1767225600";
    const token = "token";
    const signingKey = "signing_key";
    const signature = createHmac("sha256", signingKey).update(`${timestamp}${token}`).digest("hex");

    await expect(
      mailgunInbound({ signingKey }).verify?.({
        timestamp,
        token,
        signature,
      }),
    ).resolves.toBe(true);
  });
});
