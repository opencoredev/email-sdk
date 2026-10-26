import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { stubFetch } from "../test-support/fetch.js";
import {
  type InboundEmail,
  fetchMailtrapInboundEmail,
  fetchResendInboundEmail,
  parseBrevoInbound,
  parseJetEmailInbound,
  parseLettermintInbound,
  parseLettrInbound,
  parseMailerSendInbound,
  parseMailgunInbound,
  parseMailPaceInbound,
  parseMandrillInbound,
  parsePostmarkInbound,
  parseSendGridInbound,
  parseSparkPostInbound,
} from "./inbound.js";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./__fixtures__/inbound/${name}`, import.meta.url)));

const pdf = fixture("attachment.pdf.bin");

const png = fixture("logo.png.bin");

const pdf64 = Buffer.from(pdf).toString("base64");

const png64 = Buffer.from(png).toString("base64");

const cid = "logo@acme";

/** One regular PDF attachment plus one inline PNG referenced as `cid:logo@acme`. */
const mime = [
  "From: Ada <ada@example.com>",
  "To: support@acme.test",
  "Subject: Inline",
  "MIME-Version: 1.0",
  'Content-Type: multipart/mixed; boundary="mixed"',
  "",
  "--mixed",
  'Content-Type: multipart/related; boundary="related"',
  "",
  "--related",
  "Content-Type: text/html; charset=utf-8",
  "",
  `<img src="cid:${cid}">`,
  "--related",
  "Content-Type: image/png",
  "Content-Transfer-Encoding: base64",
  `Content-ID: <${cid}>`,
  'Content-Disposition: inline; filename="logo.png"',
  "",
  png64,
  "--related--",
  "--mixed",
  "Content-Type: application/pdf",
  "Content-Transfer-Encoding: base64",
  'Content-Disposition: attachment; filename="report.pdf"',
  "",
  pdf64,
  "--mixed--",
  "",
].join("\r\n");

function multipart(boundary: string, parts: { name: string; value: string | Uint8Array; filename?: string; type?: string }[]) {
  const encoder = new TextEncoder();

  const chunks = parts.flatMap(part => {
    const disposition = `form-data; name="${part.name}"${part.filename === undefined ? "" : `; filename="${part.filename}"`}`;
    const type = part.type ? `\r\nContent-Type: ${part.type}` : "";

    return [
      encoder.encode(`--${boundary}\r\nContent-Disposition: ${disposition}${type}\r\n\r\n`),
      part.value instanceof Uint8Array ? part.value : encoder.encode(part.value),
      encoder.encode("\r\n"),
    ];
  });

  return new Uint8Array(Buffer.concat([...chunks, encoder.encode(`--${boundary}--\r\n`)]));
}

async function mailgunPayload() {
  const form = new FormData();
  form.append("recipient", "support@acme.test");
  form.append("body-html", `<img src="cid:${cid}">`);
  form.append("content-id-map", JSON.stringify({ [`<${cid}>`]: "attachment-2" }));
  form.append("attachment-1", new File([pdf], "report.pdf", { type: "application/pdf" }));
  form.append("attachment-2", new File([png], "logo.png", { type: "image/png" }));

  const request = new Request("https://example.test/inbound", { method: "POST", body: form });
  const headers = new Headers(request.headers);

  return { body: new Uint8Array(await request.arrayBuffer()), headers };
}

/** Serve each URL path from a map, so remote attachments read real bytes. */
function routes(map: Record<string, () => Response>) {
  return stubFetch(async input => {
    const path = new URL(String(input)).pathname;
    const entry = map[path];

    return entry ? entry() : new Response("not found", { status: 404 });
  });
}

interface InlineCase {
  name: string;
  parse: () => Promise<InboundEmail>;
}

const relay = (rfc822: string) => JSON.stringify([{ msys: { relay_message: { rcpt_to: "support@acme.test", content: { email_rfc822: rfc822 } } } }]);

const cases: InlineCase[] = [
  {
    name: "Postmark ContentID",
    parse: async () => parsePostmarkInbound({
      body: JSON.stringify({
        Attachments: [
          { Name: "report.pdf", ContentType: "application/pdf", Content: pdf64, ContentLength: pdf.length },
          { Name: "logo.png", ContentType: "image/png", Content: png64, ContentLength: png.length, ContentID: `<${cid}>` },
        ],
      }),
    }),
  },
  {
    name: "SendGrid parsed mode with content-ids",
    parse: async () => parseSendGridInbound({
      headers: { "content-type": "multipart/form-data; boundary=sg" },
      body: multipart("sg", [
        { name: "to", value: "support@acme.test" },
        { name: "html", value: `<img src="cid:${cid}">` },
        { name: "attachments", value: "2" },
        { name: "attachment-info", value: JSON.stringify({ attachment1: { filename: "report.pdf", type: "application/pdf" }, attachment2: { filename: "logo.png", type: "image/png" } }) },
        { name: "content-ids", value: JSON.stringify({ [cid]: "attachment2" }) },
        { name: "attachment1", value: pdf, filename: "report.pdf", type: "application/pdf" },
        { name: "attachment2", value: png, filename: "logo.png", type: "image/png" },
      ]),
    }),
  },
  {
    name: "SendGrid parsed mode with attachment-info content-id",
    parse: async () => parseSendGridInbound({
      headers: { "content-type": "multipart/form-data; boundary=sg" },
      body: multipart("sg", [
        { name: "to", value: "support@acme.test" },
        { name: "attachment-info", value: JSON.stringify({ attachment1: { filename: "report.pdf", type: "application/pdf" }, attachment2: { filename: "logo.png", type: "image/png", "content-id": cid } }) },
        { name: "attachment1", value: pdf, filename: "report.pdf", type: "application/pdf" },
        { name: "attachment2", value: png, filename: "logo.png", type: "image/png" },
      ]),
    }),
  },
  { name: "Mailgun content-id-map", parse: async () => parseMailgunInbound(await mailgunPayload()) },
  {
    name: "Brevo ContentID",
    parse: async () => {
      const fetch = routes({ "/v3/inbound/attachments/pdf": () => new Response(pdf), "/v3/inbound/attachments/png": () => new Response(png) });

      const [email] = parseBrevoInbound({
        body: JSON.stringify({
          items: [{
            Attachments: [
              { Name: "report.pdf", ContentType: "application/pdf", ContentLength: pdf.length, ContentID: null, DownloadToken: "pdf" },
              { Name: "logo.png", ContentType: "image/png", ContentLength: png.length, ContentID: `<${cid}>`, DownloadToken: "png" },
            ],
          }],
        }),
      }, { apiKey: "xkeysib", fetch });

      return email!;
    },
  },
  {
    name: "Mandrill images without raw_msg",
    parse: async () => {
      const events = JSON.stringify([{
        event: "inbound",
        msg: {
          email: "support@acme.test",
          html: `<img src="cid:${cid}">`,
          attachments: { "report.pdf": { name: "report.pdf", type: "application/pdf", content: pdf64, base64: true } },
          images: { [cid]: { name: cid, type: "image/png", content: png64 } },
        },
      }]);

      const [email] = await parseMandrillInbound({
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ mandrill_events: events }).toString(),
      });

      return email!;
    },
  },
  {
    name: "MailerSend attachments without raw",
    parse: async () => parseMailerSendInbound({
      body: JSON.stringify({
        type: "inbound.message",
        data: {
          html: `<img src="cid:${cid}">`,
          attachments: [
            { file_name: "logo.png", content_type: "image/png", content_disposition: "inline", content_id: cid, size: png.length, content: png64 },
            { file_name: "report.pdf", content_type: "application/pdf", content_disposition: "attachment", size: pdf.length, content: pdf64 },
          ],
        },
      }),
    }),
  },
  { name: "MailerSend raw", parse: async () => parseMailerSendInbound({ body: JSON.stringify({ type: "inbound.message", data: { raw: mime } }) }) },
  { name: "MailPace raw", parse: async () => parseMailPaceInbound({ body: JSON.stringify({ raw: mime }) }) },
  { name: "SparkPost email_rfc822", parse: async () => parseSparkPostInbound({ body: relay(mime) })[0]! },
  { name: "Lettr email_rfc822", parse: async () => parseLettrInbound({ body: relay(mime) })[0]! },
  {
    name: "Resend content_disposition and content_id",
    parse: async () => {
      const list = {
        data: [
          { id: "a1", filename: "report.pdf", content_type: "application/pdf", content_disposition: null, content_id: null, size: pdf.length, download_url: "https://cdn.resend.test/a1" },
          { id: "a2", filename: "logo.png", content_type: "image/png", content_disposition: "inline", content_id: `<${cid}>`, size: png.length, download_url: "https://cdn.resend.test/a2" },
        ],
      };

      const fetch = routes({
        "/emails/receiving/e1": () => Response.json({ id: "e1", html: `<img src="cid:${cid}">` }),
        "/emails/receiving/e1/attachments": () => Response.json(list),
        "/a1": () => new Response(pdf),
        "/a2": () => new Response(png),
      });

      return fetchResendInboundEmail("e1", { apiKey: "re_test", fetch });
    },
  },
  {
    name: "Mailtrap details without raw_message_url",
    parse: async () => {
      const fetch = routes({
        "/api/inbound/inboxes/1/messages/m1": () => Response.json({
          id: "m1",
          attachments: [
            { filename: "report.pdf", content_type: "application/pdf", content_disposition: "attachment", content_id: null, size: pdf.length, download_url: "https://files.mailtrap.test/pdf" },
            { filename: "logo.png", content_type: "image/png", content_disposition: "inline", content_id: `<${cid}>`, size: png.length, download_url: "https://files.mailtrap.test/png" },
          ],
        }),
        "/pdf": () => new Response(pdf),
        "/png": () => new Response(png),
      });

      return fetchMailtrapInboundEmail(1, "m1", { apiToken: "mt", fetch });
    },
  },
  {
    name: "JetEmail disposition and content_id",
    parse: async () => parseJetEmailInbound({
      body: JSON.stringify({
        attachments: [
          { filename: "report.pdf", content_type: "application/pdf", disposition: "attachment", content: pdf64 },
          { filename: "logo.png", content_type: "image/png", disposition: "inline", content_id: `<${cid}>`, content: png64 },
        ],
      }),
    }),
  },
  {
    name: "Lettermint content_id",
    parse: async () => parseLettermintInbound({
      body: JSON.stringify({
        event: "message.inbound",
        data: {
          attachments: [
            { filename: "report.pdf", content_type: "application/pdf", content: pdf64 },
            { filename: "logo.png", content_type: "image/png", content_id: `<${cid}>`, content: png64 },
          ],
        },
      }),
    }),
  },
];

describe("inline images on every parsed-payload path", () => {
  test.each(cases.map(entry => [entry.name, entry] as const))("%s", async (_name, entry) => {
    const email = await entry.parse();

    const summary = await Promise.all(email.attachments.map(async attachment => ({
      contentType: attachment.contentType,
      contentId: attachment.contentId,
      disposition: attachment.disposition,
      bytes: Buffer.from(await attachment.read()).toString("base64"),
    })));

    expect(summary.toSorted((left, right) => left.contentType.localeCompare(right.contentType))).toEqual([
      { contentType: "application/pdf", contentId: undefined, disposition: "attachment", bytes: pdf64 },
      { contentType: "image/png", contentId: cid, disposition: "inline", bytes: png64 },
    ]);
  });
});
