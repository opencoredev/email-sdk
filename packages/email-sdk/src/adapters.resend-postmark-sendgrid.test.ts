import { describe, expect, test } from "bun:test";
import { createEmailClient } from "./core.js";
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
  messageWithoutProviderSpecificFields,
  messageWithTypedMetadata,
  typedMetadataAsStrings,
} from "../test-support/adapter-fixtures.js";
import { expectPerSendAuth } from "../test-support/credential-rotation.js";

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

  test("Resend reads apiKey and headers on every send", async () => {
    await expectPerSendAuth(
      (options) => resend(options),
      messageWithoutMetadata,
      { id: "res_123" },
    );
  });

  test("Postmark maps metadata, headers, and attachments", async () => {
    const capture = jsonCapture({ MessageID: "postmark_123", To: "ada@example.com" });

    const response = await postmark({
      serverToken: "server",
      messageStream: "outbound",
      fetch: capture.fetch,
    }).send(message, context);

    expect(response.id).toBe("postmark_123");
    expect(response.accepted).toEqual(["ada@example.com", "cc@example.com", "bcc@example.com"]);
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

  test("SendGrid sends non-string metadata as string custom_args", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_123" } });

    await sendgrid({ apiKey: "sg", fetch: capture.fetch }).send(messageWithTypedMetadata, context);

    // SendGrid rejects custom_args values that are not strings with a 400.
    expect(capture.calls[0]?.json.personalizations[0].custom_args).toEqual(typedMetadataAsStrings);
  });

  test("SendGrid personalized sends coerce metadata on every personalization", async () => {
    const capture = jsonCapture({}, { headers: { "x-message-id": "sg_batch" } });

    await sendgrid({ apiKey: "sg", fetch: capture.fetch }).sendPersonalized?.(
      {
        message: {
          from: "Acme <hello@acme.com>",
          subject: "Hi %recipient.name%",
          text: "Hi %recipient.name%",
          metadata: messageWithTypedMetadata.metadata,
        },
        recipients: [
          { to: "a@example.com", variables: { name: "Ada" } },
          { to: "b@example.com", variables: { name: "Linus" } },
        ],
      },
      context,
    );

    const personalizations: { custom_args: Record<string, string> }[] =
      capture.calls[0]?.json.personalizations;

    expect(personalizations.map((entry) => entry.custom_args)).toEqual([
      typedMetadataAsStrings,
      typedMetadataAsStrings,
    ]);
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

describe("legacy header objects", () => {
  test("send through the client to Resend instead of failing the capability check", async () => {
    const capture = jsonCapture({ id: "res_legacy" });

    const client = createEmailClient({
      adapters: [resend({ apiKey: "key", fetch: capture.fetch })],
      telemetry: false,
    });

    // JavaScript callers on the v0 shape still pass headers as a name-to-value object.
    const legacyHeaders = { "X-Entity-Ref": "order_42" };

    const result = await client.send({
      ...messageWithoutProviderSpecificFields,
      headers: legacyHeaders,
    });

    expect(result.id).toBe("res_legacy");
    expect(capture.calls[0]?.json.headers).toEqual({ "X-Entity-Ref": "order_42" });
  });

  test("direct resend.send() single-reads tags and accepts frozen messages", async () => {
    const capture = jsonCapture({ id: "res_tags" });
    const adapter = resend({ apiKey: "key", fetch: capture.fetch });

    let tagReads = 0;

    await adapter.send(
      {
        from: "a@example.com",
        to: "b@example.com",
        subject: "resend-tags",
        text: "hello",
        get tags() {
          tagReads += 1;

          return [{ name: "env", value: "prod" }];
        },
      },
      context,
    );

    expect(tagReads).toBe(1);
    expect(capture.calls[0]?.json.tags).toEqual([{ name: "env", value: "prod" }]);

    await adapter.send(
      Object.freeze({
        from: "a@example.com",
        to: "b@example.com",
        subject: "resend-frozen",
        text: "hello",
        tags: [{ name: "env", value: "prod" }],
      }),
      context,
    );

    expect(capture.calls[1]?.json.tags).toEqual([{ name: "env", value: "prod" }]);
  });

  test("direct resend.send() validates tags and snapshots flipping getters once", async () => {
    const capture = jsonCapture({ id: "res_valid" });
    const adapter = resend({ apiKey: "key", fetch: capture.fetch });

    const stringTagsMessage = {
      from: "a@example.com",
      to: "b@example.com",
      subject: "bad-tags",
      text: "hello",
    };

    Object.defineProperty(stringTagsMessage, "tags", {
      enumerable: true,
      configurable: true,
      value: "bad",
    });

    await expect(adapter.send(stringTagsMessage, context)).rejects.toThrow(EmailValidationError);

    const nullTagMessage = {
      from: "a@example.com",
      to: "b@example.com",
      subject: "null-tag",
      text: "hello",
    };

    Object.defineProperty(nullTagMessage, "tags", {
      enumerable: true,
      configurable: true,
      value: [null],
    });

    await expect(adapter.send(nullTagMessage, context)).rejects.toThrow(EmailValidationError);

    expect(capture.calls).toHaveLength(0);

    let toReads = 0;

    await adapter.send(
      {
        from: "a@example.com",
        get to() {
          toReads += 1;

          return toReads === 1 ? "good@example.com" : "evil@example.com";
        },
        subject: "flipping-to",
        text: "hello",
      },
      context,
    );

    expect(toReads).toBe(1);
    expect(capture.calls[0]?.json.to).toEqual(["good@example.com"]);

    // Direct resend enforces repeatedHeaders: false and direct postmark validates messages.
    const repeatCapture = jsonCapture({ id: "res_rep" });

    await expect(
      resend({ apiKey: "key", fetch: repeatCapture.fetch }).send(
        {
          from: "a@example.com",
          to: "b@example.com",
          subject: "dup-hdr",
          text: "hello",
          headers: [
            { name: "X-Foo", value: "1" },
            { name: "x-foo", value: "2" },
          ],
        },
        context,
      ),
    ).rejects.toThrow(EmailValidationError);
    expect(repeatCapture.calls).toHaveLength(0);

    const pmCapture = jsonCapture({ MessageID: "pm_bad" });

    await expect(
      postmark({ serverToken: "server", fetch: pmCapture.fetch }).send(
        { from: "a@example.com", to: [], subject: "s", text: "t" },
        context,
      ),
    ).rejects.toThrow(EmailValidationError);
    expect(pmCapture.calls).toHaveLength(0);

    // Direct resend.validate() single-reads message getters.
    let validateFromReads = 0;

    resend({ apiKey: "key", fetch: repeatCapture.fetch }).validate?.(
      {
        get from() {
          validateFromReads += 1;

          return "a@example.com";
        },
        to: "b@example.com",
        subject: "once",
        text: "hello",
      },
      { adapter: "resend", operation: "send" },
    );

    expect(validateFromReads).toBe(1);

    // Direct sendgrid.sendPersonalized() preserves class-instance template getters and single-reads recipients.
    let recipientReads = 0;
    const sgCapture = jsonCapture({ message_id: "sg_cls" });

    class ClassTemplate {
      get from() {
        return "sender@example.com";
      }

      get subject() {
        return "Hello %recipient.name%";
      }

      get text() {
        return "Hi %recipient.name%";
      }
    }

    const sgAdapter = sendgrid({ apiKey: "sg_key", fetch: sgCapture.fetch });

    const sgResult = await sgAdapter.sendPersonalized!(
      {
        message: new ClassTemplate(),
        get recipients() {
          recipientReads += 1;

          return [{ to: "alice@example.com", variables: { name: "Alice" } }];
        },
      },
      { adapter: "sendgrid", operation: "personalized", attempt: 1 },
    );

    expect(recipientReads).toBe(1);
    expect(sgResult.accepted).toEqual(["alice@example.com"]);
    expect(sgCapture.calls).toHaveLength(1);
  });
});
