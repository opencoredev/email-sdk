import { describe, expect, test } from "bun:test";
import { brevo } from "./brevo.js";
import { cloudflare } from "./cloudflare.js";
import { iterable } from "./iterable.js";
import { jetemail } from "./jetemail.js";
import { lettermint } from "./lettermint.js";
import { lettr } from "./lettr.js";
import { loops } from "./loops.js";
import { mailchimp } from "./mailchimp.js";
import { mailersend } from "./mailersend.js";
import { mailpace } from "./mailpace.js";
import { mailtrap } from "./mailtrap.js";
import { plunk } from "./plunk.js";
import { postmark } from "./postmark.js";
import { primitive } from "./primitive.js";
import { resend } from "./resend.js";
import { scaleway } from "./scaleway.js";
import { sequenzy } from "./sequenzy.js";
import { ses } from "./ses.js";
import { sparkpost } from "./sparkpost.js";
import { unosend } from "./unosend.js";
import {
  context,
  jsonCapture,
  message,
  messageWithoutMetadata,
  messageWithoutProviderSpecificFields,
  messageWithoutReplyToOrMetadata,
} from "../test-support/adapter-fixtures.js";

describe("provider payloads", () => {
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
      sequenzy({ apiKey: "key", fetch: jsonCapture({ success: true }).fetch }).send(
        { ...limitedMessage, cc: "cc@example.com" },
        context,
      ),
    ).rejects.toThrow("sequenzy does not support");

    await expect(
      jetemail({ apiKey: "key", fetch: jsonCapture({ id: "jet_123" }).fetch }).send(
        { ...limitedMessage, metadata: { id: "nope" } },
        context,
      ),
    ).rejects.toThrow("jetemail does not support");

    await expect(
      primitive({
        apiKey: "key",
        fetch: jsonCapture({ success: true, data: { id: "prim_123" } }).fetch,
      }).send(limitedMessage, context),
    ).rejects.toThrow("primitive does not support");

    await expect(
      cloudflare({
        apiToken: "token",
        accountId: "account",
        fetch: jsonCapture({ success: true }).fetch,
      }).send({ ...limitedMessage, metadata: { id: "nope" } }, context),
    ).rejects.toThrow("cloudflare does not support");

    await expect(
      unosend({ apiKey: "key", fetch: jsonCapture({ success: true }).fetch }).send(
        { ...limitedMessage, metadata: { id: "nope" } },
        context,
      ),
    ).rejects.toThrow("unosend does not support");

    await expect(
      iterable({
        apiKey: "key",
        campaignId: 123,
        fetch: jsonCapture({ msg: "iterable_123" }).fetch,
      }).send({ ...limitedMessage, headers: { "X-Test": "yes" } }, context),
    ).rejects.toThrow("iterable does not support");
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
      lettermint({ apiToken: "lm", fetch: jsonCapture({ message_id: "lm_123" }).fetch }).send(
        {
          ...message,
          tags: [
            { name: "kind", value: "welcome" },
            { name: "plan", value: "pro" },
          ],
        },
        context,
      ),
    ).rejects.toThrow("lettermint only supports 1 tag per message");

    await expect(
      lettr({
        apiKey: "lttr",
        fetch: jsonCapture({ data: { request_id: "lttr_123" } }).fetch,
      }).send(
        {
          ...message,
          to: "ada@example.com",
          tags: [
            { name: "kind", value: "welcome" },
            { name: "plan", value: "pro" },
          ],
        },
        context,
      ),
    ).rejects.toThrow("lettr only supports 1 tag per message");

    await expect(
      lettr({
        apiKey: "lttr",
        fetch: jsonCapture({ data: { request_id: "lttr_123" } }).fetch,
      }).send(
        {
          ...message,
          to: "ada@example.com",
          replyTo: ["reply@example.com", "support@example.com"],
        },
        context,
      ),
    ).rejects.toThrow("lettr only supports 1 replyTo per message");

    await expect(
      lettr({
        apiKey: "lttr",
        fetch: jsonCapture({ data: { request_id: "lttr_123" } }).fetch,
      }).send(message, context),
    ).rejects.toThrow("lettr recipient fields only support plain email addresses");

    await expect(
      lettr({
        apiKey: "lttr",
        fetch: jsonCapture({ data: { request_id: "lttr_123" } }).fetch,
      }).send(
        {
          ...message,
          to: Array.from({ length: 51 }, (_, index) => `user${index}@example.com`),
          cc: undefined,
          bcc: undefined,
        },
        context,
      ),
    ).rejects.toThrow("lettr only supports 50 recipients per message");

    await expect(
      lettr({
        apiKey: "lttr",
        fetch: jsonCapture({ data: { request_id: "lttr_123" } }).fetch,
      }).send(
        {
          ...message,
          to: "ada@example.com",
          attachments: [
            { filename: "logo.png", content: "x", contentType: "image/png", contentId: "logo" },
          ],
        },
        context,
      ),
    ).rejects.toThrow("lettr does not support inline attachments");

    await expect(
      lettr({
        apiKey: "lttr",
        fetch: jsonCapture({ data: { request_id: "lttr_123" } }).fetch,
      }).send(
        {
          ...message,
          to: "ada@example.com",
          headers: { "List-Unsubscribe": "<mailto:unsub@example.com>" },
        },
        context,
      ),
    ).rejects.toThrow("lettr does not allow setting the List-Unsubscribe header");

    await expect(
      lettr({
        apiKey: "lttr",
        fetch: jsonCapture({ data: { request_id: "lttr_123" } }).fetch,
      }).send(
        {
          ...message,
          to: "ada@example.com",
          headers: Object.fromEntries(
            Array.from({ length: 11 }, (_, index) => [`X-Test-${index}`, "value"]),
          ),
        },
        context,
      ),
    ).rejects.toThrow("lettr only supports 10 headers per message");

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
      unosend({ apiKey: "key", fetch: jsonCapture({ success: true }).fetch }).send(
        {
          ...messageWithoutMetadata,
          replyTo: ["reply@example.com", "support@example.com"],
        },
        context,
      ),
    ).rejects.toThrow("unosend only supports 1 replyTo per message");

    await expect(
      cloudflare({
        apiToken: "token",
        accountId: "account",
        fetch: jsonCapture({ success: true }).fetch,
      }).send(messageWithoutProviderSpecificFields, context),
    ).rejects.toThrow("cloudflare recipient fields only support plain email addresses");

    await expect(
      iterable({
        apiKey: "key",
        campaignId: 123,
        fetch: jsonCapture({ msg: "iterable_123" }).fetch,
      }).send(
        {
          ...message,
          to: ["ada@example.com", "grace@example.com"],
          cc: undefined,
          bcc: undefined,
          replyTo: undefined,
          headers: undefined,
          tags: undefined,
          attachments: undefined,
          metadata: undefined,
        },
        context,
      ),
    ).rejects.toThrow("iterable only supports 1 recipient per message");
  });
});
