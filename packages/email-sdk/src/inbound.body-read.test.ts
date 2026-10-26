import { describe, expect, test } from "bun:test";
import { stubFetch } from "../test-support/fetch.js";
import type { JsonObject } from "./internal/decode.js";
import {
  type InboundEmail,
  InboundError,
  type InboundProvider,
  type InboundVerification,
  fetchGraphInboundEmail,
  fetchMailgunStoredEmail,
  fetchMailtrapInboundEmail,
  fetchPostmarkInboundEmail,
  fetchResendInboundEmail,
  fetchSesInboundFromS3,
  parseBrevoInbound,
  parseLettermintInbound,
  parsePrimitiveInbound,
  parseSnsMessage,
  verifySnsMessage,
} from "./inbound.js";

const encoder = new TextEncoder();

const dropped = new TypeError("socket closed mid-body");

/** A body that sends its first chunk, then fails the way a dropped connection or late abort does. */
function brokenBody(): ReadableStream<Uint8Array> {
  let sent = false;

  return new ReadableStream({
    pull(controller) {
      if (sent) {
        controller.error(dropped);

        return;
      }

      sent = true;
      controller.enqueue(encoder.encode('{"id":"m1",'));
    },
  });
}

const broken = (type = "application/json") => new Response(brokenBody(), { headers: { "content-type": type } });

/** Serve JSON for listed paths and a broken body for every other request. */
function fetchBreaking(json: Readonly<Record<string, JsonObject>> = {}) {
  return stubFetch(async input => {
    const value = json[new URL(String(input)).pathname];

    return value === undefined ? broken() : Response.json(value);
  });
}

interface BodyReadCase {
  name: string;
  provider: InboundProvider;
  run: () => Promise<InboundEmail | Uint8Array | InboundVerification>;
}

const sns = JSON.stringify({
  Type: "Notification",
  MessageId: "m1",
  TopicArn: "arn:aws:sns:us-east-1:123456789012:inbound",
  Message: "{}",
  Timestamp: "2025-10-06T09:00:00.000Z",
  SignatureVersion: "2",
  Signature: "AAAA",
  SigningCertURL: "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem",
});

const cases: BodyReadCase[] = [
  { name: "Resend email JSON", provider: "resend", run: () => fetchResendInboundEmail("e1", { apiKey: "re", fetch: fetchBreaking() }) },
  {
    name: "Resend attachment download",
    provider: "resend",
    run: async () => {
      const fetch = fetchBreaking({
        "/emails/receiving/e1": { id: "e1" },
        "/emails/receiving/e1/attachments": { data: [{ id: "a1", filename: "a.pdf", download_url: "https://cdn.resend.test/a1" }] },
      });

      return (await fetchResendInboundEmail("e1", { apiKey: "re", fetch })).attachments[0]!.read();
    },
  },
  { name: "Postmark details JSON", provider: "postmark", run: () => fetchPostmarkInboundEmail("m1", { serverToken: "pm", fetch: fetchBreaking() }) },
  { name: "Mailtrap details JSON", provider: "mailtrap", run: () => fetchMailtrapInboundEmail(1, "m1", { apiToken: "mt", fetch: fetchBreaking() }) },
  {
    name: "Mailtrap raw message",
    provider: "mailtrap",
    run: () => fetchMailtrapInboundEmail(1, "m1", {
      apiToken: "mt",
      fetch: fetchBreaking({ "/api/inbound/inboxes/1/messages/m1": { id: "m1", raw_message_url: "https://files.mailtrap.test/m1.eml" } }),
    }),
  },
  {
    name: "Mailtrap attachment download",
    provider: "mailtrap",
    run: async () => {
      const fetch = fetchBreaking({ "/api/inbound/inboxes/1/messages/m1": { id: "m1", attachments: [{ filename: "a.pdf", download_url: "https://files.mailtrap.test/a" }] } });

      return (await fetchMailtrapInboundEmail(1, "m1", { apiToken: "mt", fetch })).attachments[0]!.read();
    },
  },
  {
    name: "Mailgun stored MIME",
    provider: "mailgun",
    run: () => fetchMailgunStoredEmail("https://storage-us-east4.api.mailgun.net/v3/domains/acme.test/messages/k1", {
      apiKey: "mg",
      fetch: stubFetch(async () => broken("message/rfc2822")),
    }),
  },
  {
    name: "Mailgun stored JSON",
    provider: "mailgun",
    run: () => fetchMailgunStoredEmail("https://storage-us-east4.api.mailgun.net/v3/domains/acme.test/messages/k1", { apiKey: "mg", fetch: fetchBreaking() }),
  },
  {
    name: "Brevo attachment download",
    provider: "brevo",
    run: () => parseBrevoInbound(
      { body: JSON.stringify({ items: [{ Attachments: [{ Name: "a.pdf", DownloadToken: "tok" }] }] }) },
      { apiKey: "xkeysib", fetch: fetchBreaking() },
    )[0]!.attachments[0]!.read(),
  },
  {
    name: "Lettermint attachment URL",
    provider: "lettermint",
    run: () => parseLettermintInbound(
      { body: JSON.stringify({ event: "message.inbound", data: { attachments: [{ filename: "a.pdf", url: "https://files.lettermint.test/a" }] } }) },
      { fetch: fetchBreaking() },
    ).attachments[0]!.read(),
  },
  {
    name: "Primitive raw download",
    provider: "primitive",
    run: () => parsePrimitiveInbound(
      { body: JSON.stringify({ event: "email.received", email: { id: "em1", content: { raw: { included: false }, download: { url: "https://api.primitive.dev/v1/emails/em1/raw" } } } }) },
      { fetch: fetchBreaking() },
    ),
  },
  {
    name: "Graph MIME",
    provider: "graph",
    run: () => fetchGraphInboundEmail("users/u1/messages/m1", { getAccessToken: () => "token", fetch: fetchBreaking() }),
  },
  {
    name: "SES S3 object",
    provider: "ses",
    run: () => fetchSesInboundFromS3({ bucket: "inbound-mail", key: "mail/m1" }, { accessKeyId: "AKID", secretAccessKey: "secret", region: "us-east-1", fetch: fetchBreaking() }),
  },
  {
    name: "SNS signing certificate",
    provider: "ses",
    run: () => verifySnsMessage(parseSnsMessage(sns), { now: Date.parse("2025-10-06T09:00:00.000Z"), certificateCache: new Map(), fetch: fetchBreaking() }),
  },
];

describe("a body that fails mid-read", () => {
  test.each(cases.map(entry => [entry.name, entry] as const))("%s rejects with fetch_failed", async (_name, entry) => {
    const result = entry.run();

    await expect(result).rejects.toBeInstanceOf(InboundError);
    await expect(result).rejects.toMatchObject({ reason: "fetch_failed", provider: entry.provider, cause: dropped });
  });
});

describe("a body that arrives whole but is not JSON", () => {
  test("stays payload_invalid", async () => {
    const fetch = stubFetch(async () => new Response("<html>", { headers: { "content-type": "application/json" } }));
    const result = fetchPostmarkInboundEmail("m1", { serverToken: "pm", fetch });

    await expect(result).rejects.toBeInstanceOf(InboundError);
    await expect(result).rejects.toMatchObject({ reason: "payload_invalid", provider: "postmark" });
  });
});
