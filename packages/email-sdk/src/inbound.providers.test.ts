import { describe, expect, test } from "bun:test";
import { createHmac, generateKeyPairSync, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { stubFetch } from "../test-support/fetch.js";
import {
  InboundError,
  fetchMailgunStoredEmail,
  fetchMailtrapInboundEmail,
  fetchPostmarkInboundEmail,
  fetchResendInboundEmail,
  parseBrevoInbound,
  parseCloudflareInbound,
  parseJetEmailInbound,
  parseLettermintInbound,
  parseLettrInbound,
  parseMailerSendInbound,
  parseMailgunInbound,
  parseMailPaceInbound,
  parseMandrillInbound,
  parsePostmarkInbound,
  parsePrimitiveInbound,
  parseResendInbound,
  parseSendGridInbound,
  parseSparkPostInbound,
  verifyBasicAuth,
  verifyBearerToken,
  verifyJetEmailInbound,
  verifyLettermintInbound,
  verifyMailerSendInbound,
  verifyMailgunInbound,
  verifyMailPaceInbound,
  verifyMailtrapInbound,
  verifyMandrillInbound,
  verifyPrimitiveInbound,
  verifyResendInbound,
  verifySendGridInbound,
  verifySparkPostInbound,
} from "./inbound.js";

const fixtureUrl = (name: string) => new URL(`./__fixtures__/inbound/${name}`, import.meta.url);

const text = (name: string) => readFileSync(fixtureUrl(name), "utf8");

const bytes = (name: string) => new Uint8Array(readFileSync(fixtureUrl(name)));

const now = 1_760_000_000_000;

const seconds = String(now / 1000);

const hex = (key: string, value: string | Uint8Array) => createHmac("sha256", key).update(value).digest("hex");

const pdf = bytes("attachment.pdf.bin");

const eml = bytes("multipart.eml");

function multipart(boundary: string, parts: { name: string; value: string | Uint8Array; filename?: string; type?: string }[]) {
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();

  for (const part of parts) {
    const disposition = `form-data; name="${part.name}"${part.filename === undefined ? "" : `; filename="${part.filename}"`}`;
    const type = part.type ? `\r\nContent-Type: ${part.type}` : "";
    chunks.push(encoder.encode(`--${boundary}\r\nContent-Disposition: ${disposition}${type}\r\n\r\n`));
    chunks.push(part.value instanceof Uint8Array ? part.value : encoder.encode(part.value));
    chunks.push(encoder.encode("\r\n"));
  }

  chunks.push(encoder.encode(`--${boundary}--\r\n`));

  return new Uint8Array(Buffer.concat(chunks));
}

describe("Resend", () => {
  const body = text("resend-email-received.json");
  const key = Buffer.from("resend-test-key");
  const secret = `whsec_${key.toString("base64")}`;

  const headers = (time = seconds, payload = body) => ({
    "svix-id": "msg_1",
    "svix-timestamp": time,
    "svix-signature": `v1,${createHmac("sha256", key).update(`msg_1.${time}.${payload}`).digest("base64")}`,
  });

  test("verifies Svix signatures and reports why they fail", async () => {
    expect(await verifyResendInbound({ body, headers: headers() }, { secret, now })).toEqual({ ok: true });
    expect(await verifyResendInbound({ body: `${body} `, headers: headers() }, { secret, now })).toEqual({ ok: false, reason: "signature_invalid" });
    expect(await verifyResendInbound({ body, headers: headers(String(+seconds - 301)) }, { secret, now })).toEqual({ ok: false, reason: "timestamp_expired" });
    expect(await verifyResendInbound({ body, headers: {} }, { secret, now })).toEqual({ ok: false, reason: "signature_missing" });
    expect(await verifyResendInbound({ body, headers: headers() }, { secret: [], now })).toEqual({ ok: false, reason: "secret_missing" });
    expect(await verifyResendInbound({ body, headers: headers() }, { secret: ["whsec_b3RoZXI=", secret], now })).toEqual({ ok: true });
  });

  test("verifies the exact body bytes, not a decoded copy", async () => {
    const original = new Uint8Array([...new TextEncoder().encode('{"type":"email.received","data":{"subject":"'), 0xef, 0xbf, 0xbd, ...new TextEncoder().encode('"}}')]);
    const signature = createHmac("sha256", key).update(Buffer.concat([Buffer.from(`msg_1.${seconds}.`), original])).digest("base64");
    const headers = { "svix-id": "msg_1", "svix-timestamp": seconds, "svix-signature": `v1,${signature}` };
    const tampered = new Uint8Array([...original.subarray(0, original.length - 6), 0xff, ...original.subarray(original.length - 3)]);

    expect(await verifyResendInbound({ body: original, headers }, { secret, now })).toEqual({ ok: true });
    expect(await verifyResendInbound({ body: tampered, headers }, { secret, now })).toEqual({ ok: false, reason: "signature_invalid" });
  });

  test("parses email.received metadata and rejects other event types", async () => {
    const email = parseResendInbound({ body });

    expect(email.id).toBe("56761188-7520-42d8-8898-ff6fc54ce618");
    expect(email.messageId).toBe("111-222-333@email.example.com");
    expect(email.from).toEqual({ address: "onboarding@resend.dev" });
    expect(email.envelope).toEqual({ to: ["forwarded@example.com"] });
    expect(email.attachments[0]).toMatchObject({ filename: "avatar.png", contentId: "img001", disposition: "inline" });
    await expect(email.attachments[0]!.read()).rejects.toThrow(InboundError);
    expect(() => parseResendInbound({ body: '{"type":"email.sent","data":{}}' })).toThrow("not email.received");
  });

  test("fetches the full received email and downloads attachments", async () => {
    const requests: string[] = [];

    const fetch = stubFetch(async (input, init) => {
      const url = String(input);
      requests.push(`${url} ${new Headers(init?.headers).get("authorization") ?? ""}`);

      if (url.endsWith("/attachments")) {
        return Response.json({ object: "list", data: [{ id: "2a0c9ce0-3112-4728-976e-47ddcd16a318", filename: "avatar.png", content_type: "image/png", download_url: "https://inbound-cdn.resend.com/a?sig=1" }] });
      }

      if (url.startsWith("https://inbound-cdn.resend.com/")) return new Response(pdf);

      return new Response(text("resend-received-email.json"));
    });

    const email = await fetchResendInboundEmail("56761188-7520-42d8-8898-ff6fc54ce618", { apiKey: "re_test", fetch });

    expect(email.from).toEqual({ address: "onboarding@resend.dev", name: "Acme" });
    expect(email.text).toBe("Hi");
    expect(email.cc).toEqual([{ address: "cc@example.com" }]);
    expect(email.references).toEqual(["root@example.com", "prev@example.com"]);
    expect(email.security).toEqual({ spf: "pass", dkim: "fail", dmarc: "gray" });
    expect(await email.attachments[0]!.read()).toEqual(pdf);
    expect(requests[0]).toBe("https://api.resend.com/emails/receiving/56761188-7520-42d8-8898-ff6fc54ce618 Bearer re_test");
    expect(requests.at(-1)).toBe("https://inbound-cdn.resend.com/a?sig=1 ");
  });

  test("maps API failures to fetch_failed with the HTTP status", async () => {
    const fetch = stubFetch(async () => new Response('{"message":"not found"}', { status: 404 }));

    await expect(fetchResendInboundEmail("missing", { apiKey: "re_test", fetch })).rejects.toMatchObject({ reason: "fetch_failed", status: 404, provider: "resend" });
  });
});

describe("Postmark", () => {
  test("keeps zero-byte attachments", async () => {
    const body = JSON.stringify({ Attachments: [{ Name: "empty.txt", ContentType: "text/plain", Content: "", ContentLength: 0 }] });
    const [attachment] = parsePostmarkInbound({ body }).attachments;

    expect(attachment).toMatchObject({ filename: "empty.txt", size: 0 });
    expect(await attachment!.read()).toEqual(new Uint8Array());
  });

  test("parses the documented inbound payload, including Bcc, spam headers, and attachments", async () => {
    const email = parsePostmarkInbound({ body: text("postmark-inbound.json") });

    expect(email.from).toEqual({ address: "support@postmarkapp.com", name: "Postmarkapp Support" });
    expect(email.to).toEqual([{ address: "yourhash+SampleHash@inbound.postmarkapp.com", name: "Firstname Lastname" }]);
    expect(email.cc).toEqual([{ address: "firstcc@postmarkapp.com", name: "First Cc" }, { address: "secondCc@postmarkapp.com" }]);
    expect(email.bcc).toEqual([{ address: "firstbcc@postmarkapp.com", name: "First Bcc" }]);
    expect(email.messageId).toBe("CAEH+example@mail.gmail.com");
    expect(email.headers.getAll("received")).toEqual(["by 10.0.0.1", "by 10.0.0.2"]);
    expect(email.security).toEqual({ spam: "pass", spamScore: -0.1 });
    expect(email.envelope).toEqual({ to: ["yourhash+SampleHash@inbound.postmarkapp.com"] });
    expect(await email.attachments[0]!.read()).toEqual(pdf);
    expect(email.attachments[1]).toMatchObject({ contentId: "logo@postmark", disposition: "inline", size: 8 });
  });

  test("checks Basic credentials from the webhook URL in constant time", () => {
    const authorization = `Basic ${Buffer.from("inbound:s3cret").toString("base64")}`;

    expect(verifyBasicAuth({ authorization }, { username: "inbound", password: "s3cret" })).toEqual({ ok: true });
    expect(verifyBasicAuth({ authorization }, { username: "inbound", password: "wrong" })).toEqual({ ok: false, reason: "signature_invalid" });
    expect(verifyBasicAuth({}, { username: "inbound", password: "s3cret" })).toEqual({ ok: false, reason: "signature_missing" });
    expect(verifyBearerToken({ authorization: "Bearer tok" }, "tok")).toEqual({ ok: true });
  });

  test("fetches inbound message details with the server token", async () => {
    const fetch = stubFetch(async (input, init) => {
      expect(String(input)).toBe("https://api.postmarkapp.com/messages/inbound/abc/details");
      expect(new Headers(init?.headers).get("x-postmark-server-token")).toBe("pm_token");

      return new Response(text("postmark-inbound.json"));
    });

    expect((await fetchPostmarkInboundEmail("abc", { serverToken: "pm_token", fetch })).subject).toBe("Test subject");
  });
});

describe("Mailgun", () => {
  const key = "mailgun-signing-key";
  const token = "a".repeat(50);

  function route(fields: Record<string, string>, files: { name: string; value: Uint8Array; filename: string; type: string }[] = []) {
    const form = new FormData();

    for (const [name, value] of Object.entries(fields)) form.append(name, value);

    for (const file of files) form.append(file.name, new File([file.value], file.filename, { type: file.type }));

    return form;
  }

  async function payload(form: FormData) {
    const request = new Request("https://example.test/inbound", { method: "POST", body: form });

    const headers = new Headers(request.headers);

    return { body: new Uint8Array(await request.arrayBuffer()), headers };
  }

  const signed = (time = seconds) => ({ timestamp: time, token, signature: hex(key, `${time}${token}`) });

  test("parses a routed multipart post with headers, attachments, and content-id-map", async () => {
    const form = route({
      ...signed(),
      recipient: "support@acme.test",
      sender: "bounce@example.net",
      from: "José <jose@example.net>",
      subject: "Café order",
      "body-plain": "Hello",
      "body-html": "<p>Hello</p>",
      "attachment-count": "2",
      "message-headers": JSON.stringify([["Received", "by a"], ["Received", "by b"], ["Message-Id", "<mg-1@example.net>"], ["To", "support@acme.test"], ["X-Mailgun-Spf", "Pass"], ["X-Mailgun-Sflag", "No"], ["X-Mailgun-Sscore", "0.3"]]),
      "content-id-map": JSON.stringify({ "<logo@mg>": "attachment-2" }),
    }, [
      { name: "attachment-1", value: pdf, filename: "report.pdf", type: "application/pdf" },
      { name: "attachment-2", value: bytes("logo.png.bin"), filename: "logo.png", type: "image/png" },
    ]);

    const request = await payload(form);

    expect(await verifyMailgunInbound(request, { secret: key, now })).toEqual({ ok: true });

    const email = await parseMailgunInbound(request);

    expect(email.from).toEqual({ address: "jose@example.net", name: "José" });
    expect(email.messageId).toBe("mg-1@example.net");
    expect(email.envelope).toEqual({ from: "bounce@example.net", to: ["support@acme.test"] });
    expect(email.headers.getAll("received")).toEqual(["by a", "by b"]);
    expect(email.security).toEqual({ spf: "pass", spam: "pass", spamScore: 0.3 });
    expect(await email.attachments[0]!.read()).toEqual(pdf);
    expect(email.attachments[1]).toMatchObject({ filename: "logo.png", contentId: "logo@mg", disposition: "inline" });
  });

  test("parses raw MIME from routes that forward to a /mime URL", async () => {
    const email = await parseMailgunInbound(await payload(route({ ...signed(), recipient: "support@acme.test", "body-mime": new TextDecoder("latin1").decode(eml) })));

    expect(email.subject).toBe("Café order ✉ #42");
    expect(email.attachments).toHaveLength(3);
  });

  test("rejects bad, replayed-old, and missing signatures", async () => {
    expect(await verifyMailgunInbound(await payload(route({ ...signed(), signature: "0".repeat(64) })), { secret: key, now })).toEqual({ ok: false, reason: "signature_invalid" });
    expect(await verifyMailgunInbound(await payload(route(signed(String(+seconds - 3600)))), { secret: key, now })).toEqual({ ok: false, reason: "timestamp_expired" });
    expect(await verifyMailgunInbound(await payload(route({ recipient: "x@y.test" })), { secret: key, now })).toEqual({ ok: false, reason: "signature_missing" });
    expect(await verifyMailgunInbound({ body: "x", headers: {} }, { secret: key, now })).toEqual({ ok: false, reason: "payload_invalid" });
  });

  test("fetches stored messages only from Mailgun storage hosts", async () => {
    const fetch = stubFetch(async (input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toBe(`Basic ${Buffer.from("api:key-1").toString("base64")}`);

      return Response.json({ "body-mime": new TextDecoder("latin1").decode(eml), recipients: "support@acme.test", sender: "bounce@example.net" });
    });

    const email = await fetchMailgunStoredEmail("https://storage-us-east4.api.mailgun.net/v3/domains/acme.test/messages/abc", { apiKey: "key-1", fetch });

    expect(email.envelope).toEqual({ from: "bounce@example.net", to: ["support@acme.test"] });
    await expect(fetchMailgunStoredEmail("https://evil.test/v3/messages/abc", { apiKey: "key-1", fetch })).rejects.toThrow("storage URL");
  });
});

describe("SendGrid Inbound Parse", () => {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
  const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");

  function signedHeaders(body: Uint8Array, contentType: string, time = seconds) {
    const signature = sign("sha256", Buffer.concat([Buffer.from(time), body]), privateKey).toString("base64");

    return {
      "content-type": contentType,
      "x-twilio-email-event-webhook-signature": signature,
      "x-twilio-email-event-webhook-timestamp": time,
    };
  }

  const latin1Subject = new Uint8Array([0x43, 0x61, 0x66, 0xe9]);

  const parsedBody = multipart("sg-boundary", [
    { name: "headers", value: "Message-ID: <sg-1@example.net>\r\nIn-Reply-To: <prev@acme.test>\r\nFrom: Jose <jose@example.net>\r\nTo: support@acme.test\r\nAuthentication-Results: mx.sendgrid.net; dmarc=pass\r\n" },
    { name: "from", value: "Jose <jose@example.net>" },
    { name: "to", value: "support@acme.test" },
    { name: "cc", value: "\"Ops\" <ops@acme.test>" },
    { name: "subject", value: latin1Subject },
    { name: "text", value: "Hello" },
    { name: "html", value: "<p>Hello</p>" },
    { name: "envelope", value: '{"to":["support@acme.test"],"from":"bounce@example.net"}' },
    { name: "charsets", value: '{"to":"UTF-8","subject":"iso-8859-1","text":"UTF-8","html":"UTF-8","from":"UTF-8"}' },
    { name: "SPF", value: "pass" },
    { name: "dkim", value: "{@example.net : pass}" },
    { name: "spam_score", value: "0.012" },
    { name: "attachments", value: "1" },
    { name: "attachment-info", value: '{"attachment1":{"filename":"report.pdf","name":"report.pdf","type":"application/pdf"}}' },
    { name: "attachment1", value: pdf, filename: "report.pdf", type: "application/pdf" },
  ]);

  const contentType = "multipart/form-data; boundary=sg-boundary";

  test("verifies the ECDSA signature over timestamp + raw body", async () => {
    expect(await verifySendGridInbound({ body: parsedBody, headers: signedHeaders(parsedBody, contentType) }, { publicKey: spki, now })).toEqual({ ok: true });

    const tampered = new Uint8Array(parsedBody);
    tampered[tampered.length - 10] ^= 1;

    expect(await verifySendGridInbound({ body: tampered, headers: signedHeaders(parsedBody, contentType) }, { publicKey: spki, now })).toEqual({ ok: false, reason: "signature_invalid" });
    expect(await verifySendGridInbound({ body: parsedBody, headers: signedHeaders(parsedBody, contentType, String(+seconds - 600)) }, { publicKey: spki, now })).toEqual({ ok: false, reason: "timestamp_expired" });
  });

  test("decodes fields in their declared charsets and keeps attachment bytes exact", async () => {
    const email = parseSendGridInbound({ body: parsedBody, headers: { "content-type": contentType } });

    expect(email.subject).toBe("Café");
    expect(email.messageId).toBe("sg-1@example.net");
    expect(email.inReplyTo).toBe("prev@acme.test");
    expect(email.cc).toEqual([{ address: "ops@acme.test", name: "Ops" }]);
    expect(email.envelope).toEqual({ from: "bounce@example.net", to: ["support@acme.test"] });
    expect(email.security).toEqual({ spf: "pass", dkim: "pass", spamScore: 0.012 });
    expect(await email.attachments[0]!.read()).toEqual(pdf);
    expect(email.raw.kind).toBe("form");
  });

  test("parses Send Raw mode from the email field", () => {
    const body = multipart("raw-b", [
      { name: "email", value: eml },
      { name: "envelope", value: '{"to":["support@acme.test"],"from":"bounce@example.net"}' },
      { name: "SPF", value: "softfail" },
    ]);

    const email = parseSendGridInbound({ body, headers: { "content-type": "multipart/form-data; boundary=raw-b" } });

    expect(email.subject).toBe("Café order ✉ #42");
    expect(email.security.spf).toBe("softfail");
    expect(email.attachments).toHaveLength(3);
  });

  test("rejects non-multipart bodies", () => {
    expect(() => parseSendGridInbound({ body: "{}", headers: { "content-type": "application/json" } })).toThrow(InboundError);
  });
});

describe("Mailchimp Transactional (Mandrill)", () => {
  const key = "mandrill-key";
  const url = "https://example.test/inbound?route=1";

  const events = JSON.stringify([
    { event: "inbound", ts: 1_700_000_000, msg: { raw_msg: new TextDecoder("latin1").decode(eml), email: "support@acme.test", spf: { result: "pass" }, dkim: { signed: true, valid: false }, spam_report: { score: 2.1, matched_rules: [] } } },
    { event: "inbound", ts: 1_700_000_001, msg: { from_email: "ada@example.com", from_name: "Ada", to: [["support@acme.test", null]], email: "support@acme.test", subject: "Hi", text: "Hello", headers: { Received: ["a", "b"], "Message-Id": "<m2@example.com>", "In-Reply-To": "<m1@example.com>", References: "<m0@example.com> <m1@example.com>" }, attachments: { "note.txt": { name: "note.txt", type: "text/plain", content: "aGk=", base64: true } } } },
    { event: "send", ts: 1, msg: {} },
  ]);

  const body = new URLSearchParams({ mandrill_events: events }).toString();
  const headers = (signature: string) => ({ "content-type": "application/x-www-form-urlencoded", "x-mandrill-signature": signature });
  const signature = createHmac("sha1", key).update(`${url}mandrill_events${events}`).digest("base64");

  test("verifies the URL + sorted fields HMAC-SHA1 signature", async () => {
    expect(await verifyMandrillInbound({ body, headers: headers(signature) }, { secret: key, url })).toEqual({ ok: true });
    expect(await verifyMandrillInbound({ body, headers: headers(signature) }, { secret: key, url: "https://example.test/other" })).toEqual({ ok: false, reason: "signature_invalid" });
  });

  test("parses each inbound event and skips other event types", async () => {
    const [raw, parsed, ...rest] = await parseMandrillInbound({ body, headers: headers(signature) });

    expect(rest).toEqual([]);
    expect(raw!.subject).toBe("Café order ✉ #42");
    expect(raw!.security).toEqual({ spf: "pass", dkim: "fail", spamScore: 2.1 });
    expect(parsed!.to).toEqual([{ address: "support@acme.test" }]);
    expect(parsed!.headers.getAll("received")).toEqual(["a", "b"]);
    expect(parsed!.messageId).toBe("m2@example.com");
    expect(parsed!.inReplyTo).toBe("m1@example.com");
    expect(parsed!.references).toEqual(["m0@example.com", "m1@example.com"]);
    expect(new TextDecoder().decode(await parsed!.attachments[0]!.read())).toBe("hi");
  });
});

describe("SparkPost and Lettr relay webhooks", () => {
  const body = text("sparkpost-relay.json");

  test("checks the X-MessageSystems-Webhook-Token", () => {
    expect(verifySparkPostInbound({ body, headers: { "x-messagesystems-webhook-token": "relay-token" } }, { secret: "relay-token" })).toEqual({ ok: true });
    expect(verifySparkPostInbound({ body, headers: { "x-messagesystems-webhook-token": "relay-tokem" } }, { secret: "relay-token" })).toEqual({ ok: false, reason: "signature_invalid" });
  });

  test("parses base64 rfc822 and header-only relay messages", () => {
    const [mime, fields] = parseSparkPostInbound({ body });

    expect(mime!.subject).toBe("Café order ✉ #42");
    expect(mime!.envelope).toEqual({ from: "bounce@example.net", to: ["support@acme.test"] });
    expect(fields!.from).toEqual({ address: "sender@example.com", name: "John Sender" });
    expect(fields!.inReplyTo).toBe("original@example.com");
    expect(parseLettrInbound({ body })[1]!.provider).toBe("lettr");
  });
});

describe("MailerSend", () => {
  const body = text("mailersend-inbound.json");

  test("verifies the hex HMAC-SHA256 Signature header", async () => {
    expect(await verifyMailerSendInbound({ body, headers: { signature: hex("ms-secret", body) } }, { secret: "ms-secret" })).toEqual({ ok: true });
    expect(await verifyMailerSendInbound({ body: body.replace("Café", "Cafe"), headers: { signature: hex("ms-secret", body) } }, { secret: "ms-secret" })).toEqual({ ok: false, reason: "signature_invalid" });
  });

  test("parses the raw message and overlays SPF/DKIM checks", () => {
    const email = parseMailerSendInbound({ body });

    expect(email.id).toBe("msg_ms_1");
    expect(email.subject).toBe("Café order ✉ #42");
    expect(email.envelope).toEqual({ from: "bounce@example.net", to: ["support@acme.test"] });
    expect(email.security).toEqual({ spf: "pass", dkim: "fail" });
  });
});

describe("MailPace", () => {
  const body = text("mailpace-inbound.json");
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const rawKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");

  test("verifies Ed25519 signatures over the raw body", async () => {
    const signature = sign(null, Buffer.from(body), privateKey).toString("base64");

    expect(await verifyMailPaceInbound({ body, headers: { "x-mailpace-signature": signature } }, { publicKey: rawKey })).toEqual({ ok: true });
    expect(await verifyMailPaceInbound({ body: `${body}\n`, headers: { "x-mailpace-signature": signature } }, { publicKey: rawKey })).toEqual({ ok: false, reason: "signature_invalid" });
  });

  test("parses the included raw message", () => {
    expect(parseMailPaceInbound({ body }).attachments).toHaveLength(3);
  });
});

describe("Lettermint", () => {
  const body = text("lettermint-message-inbound.json");
  const secret = "whsec_lettermint";

  const signed = (time = seconds, payload = body) => ({
    "x-lettermint-signature": `t=${time},v1=${hex(secret, `${time}.${payload}`)}`,
    "x-lettermint-delivery": time,
  });

  test("verifies t/v1 signatures and the matching delivery header", async () => {
    expect(await verifyLettermintInbound({ body, headers: signed() }, { secret, now })).toEqual({ ok: true });
    expect(await verifyLettermintInbound({ body, headers: { ...signed(), "x-lettermint-delivery": "1" } }, { secret, now })).toEqual({ ok: false, reason: "signature_invalid" });
    expect(await verifyLettermintInbound({ body, headers: signed(String(+seconds + 400)) }, { secret, now })).toEqual({ ok: false, reason: "timestamp_expired" });
  });

  test("parses inline and signed-URL attachments", async () => {
    const fetch = stubFetch(async () => new Response(new Uint8Array([1, 2, 3, 4])));
    const email = parseLettermintInbound({ body }, { fetch });

    expect(email.id).toBe("f47ac10b-58cc-4372-a567-0e02b2c3d479");
    expect(email.messageId).toBe("abc123@mail.example.com");
    expect(email.from).toEqual({ address: "customer@example.com", name: "John Doe" });
    expect(email.security).toEqual({ spf: "softfail", dkim: "pass", dmarc: "pass", spam: "pass", spamScore: 1.2 });
    expect(await email.attachments[0]!.read()).toEqual(pdf);
    expect(await email.attachments[1]!.read()).toEqual(new Uint8Array([1, 2, 3, 4]));
  });
});

describe("Primitive", () => {
  const body = text("primitive-email-received.json");

  test("verifies Primitive-Signature", async () => {
    const header = `t=${seconds},v1=${hex("prim-secret", `${seconds}.${body}`)}`;

    expect(await verifyPrimitiveInbound({ body, headers: { "primitive-signature": header } }, { secret: "prim-secret", now })).toEqual({ ok: true });
    expect(await verifyPrimitiveInbound({ body, headers: { "primitive-signature": header } }, { secret: "other", now })).toEqual({ ok: false, reason: "signature_invalid" });
  });

  test("parses inline raw content, or downloads it when not included", async () => {
    const email = await parsePrimitiveInbound({ body });

    expect(email.id).toBe("em_01HZYABCDEF1234567890");
    expect(email.text).toBe("Hello");
    expect(email.replyTo).toEqual([{ address: "reply@example.com", name: "Alice Support" }]);
    expect(email.security).toEqual({ spf: "pass", dmarc: "pass", dkim: "pass", spamScore: 0.1 });

    const notIncluded = body.replace('"included": true', '"included": false');

    const fetch = stubFetch(async input => {
      expect(String(input)).toContain("token=download-token");

      return new Response("Subject: downloaded\r\n\r\nbody");
    });

    expect((await parsePrimitiveInbound({ body: notIncluded }, { fetch })).subject).toBe("downloaded");
  });
});

describe("JetEmail", () => {
  const body = text("jetemail-inbound.json");

  test("verifies id.timestamp.body signatures", async () => {
    const headers = { "x-webhook-id": "job_1", "x-webhook-timestamp": seconds, "x-webhook-signature": hex("jet", `job_1.${seconds}.${body}`) };

    expect(await verifyJetEmailInbound({ body, headers }, { secret: "jet", now })).toEqual({ ok: true });
    expect(await verifyJetEmailInbound({ body, headers: { ...headers, "x-webhook-id": "job_2" } }, { secret: "jet", now })).toEqual({ ok: false, reason: "signature_invalid" });

    const replaced = new Uint8Array(Buffer.from(body.replace("Order", "\uFFFDrder")));
    const invalid = new Uint8Array(replaced);
    invalid.set([0xff, 0x20, 0x20], replaced.indexOf(0xef));
    const signedReplaced = { ...headers, "x-webhook-signature": hex("jet", Buffer.concat([Buffer.from(`job_1.${seconds}.`), replaced])) };

    expect(await verifyJetEmailInbound({ body: replaced, headers: signedReplaced }, { secret: "jet", now })).toEqual({ ok: true });
    expect(await verifyJetEmailInbound({ body: invalid, headers: signedReplaced }, { secret: "jet", now })).toEqual({ ok: false, reason: "signature_invalid" });
  });

  test("parses the documented payload", async () => {
    const email = parseJetEmailInbound({ body });

    expect(email.messageId).toBe("CAOEWyCpfbcjqB-YFzTqZ7=h2g02qCq7WLWa4qZ35N7zvkxK2Mg@mail.gmail.com");
    expect(email.security).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass" });
    expect(await email.attachments[0]!.read()).toEqual(pdf);
  });
});

describe("Brevo", () => {
  test("parses items and downloads attachments with the API key", async () => {
    const fetch = stubFetch(async (input, init) => {
      expect(String(input)).toBe("https://api.brevo.com/v3/inbound/attachments/tok_123");
      expect(new Headers(init?.headers).get("api-key")).toBe("xkeysib");

      return new Response(pdf);
    });

    const [email] = parseBrevoInbound({ body: text("brevo-inbound.json") }, { apiKey: "xkeysib", fetch });

    expect(email!.from).toEqual({ address: "ada@example.com", name: "Ada Lovelace" });
    expect(email!.inReplyTo).toBe("prev@brevo.test");
    expect(email!.references).toEqual(["root@brevo.test", "prev@brevo.test"]);
    expect(email!.headers.getAll("received")).toEqual(["by a", "by b"]);
    expect(email!.security).toEqual({ spamScore: 2.5 });
    expect(await email!.attachments[0]!.read()).toEqual(pdf);
    await expect(parseBrevoInbound({ body: text("brevo-inbound.json") })[0]!.attachments[0]!.read()).rejects.toThrow("apiKey");
  });

  test("falls back to headers for threading fields", () => {
    const body = JSON.stringify({ items: [{ Headers: { "Message-ID": "<b2@brevo.test>", "In-Reply-To": "<b1@brevo.test>", References: "<b1@brevo.test>" } }] });
    const [email] = parseBrevoInbound({ body });

    expect(email!.messageId).toBe("b2@brevo.test");
    expect(email!.inReplyTo).toBe("b1@brevo.test");
    expect(email!.references).toEqual(["b1@brevo.test"]);
  });
});

describe("Mailtrap", () => {
  test("verifies mailtrap-signature and fetches the raw .eml", async () => {
    const body = '{"events":[{"event":"inbound.message_received"}]}';

    expect(await verifyMailtrapInbound({ body, headers: { "mailtrap-signature": hex("0123456789abcdef0123456789abcdef", body) } }, { secret: "0123456789abcdef0123456789abcdef" })).toEqual({ ok: true });

    const fetch = stubFetch(async (input, init) => {
      if (String(input).startsWith("https://mailtrap.io/api/")) {
        expect(new Headers(init?.headers).get("api-token")).toBe("mt_token");

        return Response.json({ id: "m1", raw_message_url: "https://storage.mailtrap.test/m1.eml" });
      }

      return new Response(eml);
    });

    const email = await fetchMailtrapInboundEmail(42, "m1", { apiToken: "mt_token", fetch });

    expect(email.id).toBe("m1");
    expect(email.attachments).toHaveLength(3);
  });

  test("falls back to headers for threading fields without a raw message", async () => {
    const fetch = stubFetch(async () => Response.json({
      id: "m2",
      headers: { "Message-ID": "<t2@mailtrap.test>", "In-Reply-To": "<t1@mailtrap.test>", References: "<t0@mailtrap.test> <t1@mailtrap.test>" },
    }));

    const email = await fetchMailtrapInboundEmail(42, "m2", { apiToken: "mt_token", fetch });

    expect(email.messageId).toBe("t2@mailtrap.test");
    expect(email.inReplyTo).toBe("t1@mailtrap.test");
    expect(email.references).toEqual(["t0@mailtrap.test", "t1@mailtrap.test"]);
  });
});

describe("Cloudflare Email Workers", () => {
  test("parses the raw stream and keeps the envelope", async () => {
    const message = { from: "bounce@example.net", to: "support@acme.test", raw: new Response(eml).body!, rawSize: eml.length };
    const email = await parseCloudflareInbound(message);

    expect(email.provider).toBe("cloudflare");
    expect(email.envelope).toEqual({ from: "bounce@example.net", to: ["support@acme.test"] });
    expect(email.html).toContain("cid:logo@acme");
    await expect(parseCloudflareInbound(message)).rejects.toMatchObject({ reason: "payload_invalid" });
  });
});
