import { describe, expect, test } from "bun:test";
import { brevo } from "./brevo.js";
import { EmailValidationError } from "./errors.js";
import { lettr } from "./lettr.js";
import { mailchimp } from "./mailchimp.js";
import { mailersend } from "./mailersend.js";
import { mailgun } from "./mailgun.js";
import { mailtrap } from "./mailtrap.js";
import { postmark } from "./postmark.js";
import { resend } from "./resend.js";
import { ses } from "./ses.js";
import { sendgrid } from "./sendgrid.js";
import { sparkpost } from "./sparkpost.js";
import type { EmailMessage } from "./types.js";
import {
  context,
  formCapture,
  jsonCapture,
  message,
  messageWithoutMetadata,
  messageWithoutReplyTo,
} from "../test-support/adapter-fixtures.js";

describe("provider payloads", () => {
  test("adapters map sendAt to their native scheduling parameters", async () => {
    const sendAt = new Date("2026-07-10T12:30:00.000Z");
    const scheduledMessage: EmailMessage = { ...messageWithoutMetadata, sendAt };

    const resendCapture = jsonCapture({ id: "res_123" });
    await resend({ apiKey: "key", fetch: resendCapture.fetch }).send(scheduledMessage, context);
    expect(resendCapture.calls[0]?.json.scheduled_at).toBe("2026-07-10T12:30:00.000Z");

    const sendgridCapture = jsonCapture({});
    await sendgrid({ apiKey: "key", fetch: sendgridCapture.fetch }).send(
      { ...message, sendAt },
      context,
    );
    expect(sendgridCapture.calls[0]?.json.send_at).toBe(Math.floor(sendAt.getTime() / 1000));

    const brevoCapture = jsonCapture({ messageId: "brevo_123" });
    await brevo({ apiKey: "key", fetch: brevoCapture.fetch }).send({ ...message, sendAt }, context);
    expect(brevoCapture.calls[0]?.json.scheduledAt).toBe("2026-07-10T12:30:00.000Z");

    const mailgunCapture = formCapture({ id: "<mailgun_123>" });
    await mailgun({ apiKey: "mg", domain: "mg.example.com", fetch: mailgunCapture.fetch }).send(
      { ...message, sendAt },
      context,
    );
    expect(mailgunCapture.calls[0]?.form.get("o:deliverytime")).toBe(
      "Fri, 10 Jul 2026 12:30:00 +0000",
    );

    const mailersendCapture = jsonCapture({});
    await mailersend({ apiKey: "key", fetch: mailersendCapture.fetch }).send(
      { ...messageWithoutMetadata, sendAt },
      context,
    );
    expect(mailersendCapture.calls[0]?.json.send_at).toBe(Math.floor(sendAt.getTime() / 1000));

    const sparkpostCapture = jsonCapture({ results: { id: "spark_123" } });
    await sparkpost({ apiKey: "key", fetch: sparkpostCapture.fetch }).send(
      { ...message, cc: undefined, bcc: undefined, sendAt },
      context,
    );
    expect(sparkpostCapture.calls[0]?.json.options.start_time).toBe("2026-07-10T12:30:00+00:00");

    const mailchimpCapture = jsonCapture([{ _id: "mc_123" }]);
    await mailchimp({ apiKey: "key", fetch: mailchimpCapture.fetch }).send(
      { ...messageWithoutReplyTo, sendAt },
      context,
    );
    expect(mailchimpCapture.calls[0]?.json.send_at).toBe("2026-07-10 12:30:00");

    const lettrCapture = jsonCapture(
      { data: { request_id: "lttr_sched", accepted: 3, rejected: 0 } },
      { status: 201 },
    );

    await lettr({ apiKey: "lttr_key", fetch: lettrCapture.fetch }).send(
      { ...scheduledMessage, to: "ada@example.com" },
      context,
    );
    expect(lettrCapture.calls[0]?.url).toBe("https://app.lettr.com/api/emails/scheduled");
    expect(lettrCapture.calls[0]?.json.scheduled_at).toBe("2026-07-10T12:30:00.000Z");
  });

  test("native batch sends carry sendAt in the same scheduled call", async () => {
    const sendAt = new Date("2026-07-10T12:30:00.000Z");

    const batch = {
      message: {
        from: "Acme <hello@acme.com>",
        subject: "Hi %recipient.name%",
        html: "<p>Hi %recipient.name%</p>",
        sendAt,
      },
      recipients: [
        { to: "a@example.com", variables: { name: "Ada" } },
        { to: "b@example.com", variables: { name: "Linus" } },
      ],
    };

    const mailgunCapture = formCapture({ id: "<mailgun_batch>" });
    await mailgun({
      apiKey: "mg",
      domain: "mg.example.com",
      fetch: mailgunCapture.fetch,
    }).sendPersonalized?.(batch, context);
    expect(mailgunCapture.calls).toHaveLength(1);
    expect(mailgunCapture.calls[0]?.form.get("recipient-variables")).toBeTruthy();
    expect(mailgunCapture.calls[0]?.form.get("o:deliverytime")).toBe(
      "Fri, 10 Jul 2026 12:30:00 +0000",
    );

    const sendgridCapture = jsonCapture({}, { headers: { "x-message-id": "sg_batch" } });
    await sendgrid({ apiKey: "sg", fetch: sendgridCapture.fetch }).sendPersonalized?.(
      batch,
      context,
    );
    expect(sendgridCapture.calls).toHaveLength(1);
    expect(sendgridCapture.calls[0]?.json.personalizations).toHaveLength(2);
    expect(sendgridCapture.calls[0]?.json.send_at).toBe(Math.floor(sendAt.getTime() / 1000));
  });

  test("sendAt accepts ISO strings and rejects unparseable dates", async () => {
    const stringCapture = jsonCapture({ id: "res_123" });
    await resend({ apiKey: "key", fetch: stringCapture.fetch }).send(
      { ...messageWithoutMetadata, sendAt: "2026-07-10T12:30:00.000Z" },
      context,
    );
    expect(stringCapture.calls[0]?.json.scheduled_at).toBe("2026-07-10T12:30:00.000Z");

    await expect(
      resend({ apiKey: "key", fetch: jsonCapture({ id: "res_123" }).fetch }).send(
        { ...messageWithoutMetadata, sendAt: "tomorrow-ish" },
        context,
      ),
    ).rejects.toThrow("Email message sendAt must be an RFC 3339 timestamp");

    await expect(
      resend({ apiKey: "key", fetch: jsonCapture({ id: "res_123" }).fetch }).send(
        { ...messageWithoutMetadata, sendAt: new Date(Number.NaN) },
        context,
      ),
    ).rejects.toThrow(EmailValidationError);
  });

  test("adapters without native scheduling reject sendAt instead of sending immediately", async () => {
    const sendAt = "2026-07-10T12:30:00.000Z";

    await expect(
      postmark({ serverToken: "server", fetch: jsonCapture({ MessageID: "pm_123" }).fetch }).send(
        { ...message, sendAt },
        context,
      ),
    ).rejects.toThrow("postmark does not support these EmailMessage fields: sendAt");

    await expect(
      ses({
        accessKeyId: "access",
        secretAccessKey: "secret",
        region: "us-east-1",
        fetch: jsonCapture({ MessageId: "ses_123" }).fetch,
      }).send({ ...messageWithoutMetadata, sendAt }, context),
    ).rejects.toThrow("ses does not support these EmailMessage fields: sendAt");

    await expect(
      mailtrap({ apiKey: "key", fetch: jsonCapture({ message_ids: ["mt_123"] }).fetch }).send(
        { ...message, sendAt },
        context,
      ),
    ).rejects.toThrow("mailtrap does not support these EmailMessage fields: sendAt");
  });
});
