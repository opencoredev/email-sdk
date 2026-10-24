import { describe, expect, test } from "bun:test";
import { createHmac, createSign, generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { stubFetch } from "../test-support/fetch.js";
import {
  InboundError,
  certificatePublicKey,
  fetchGraphInboundEmail,
  fetchSesInboundFromS3,
  graphValidationResponse,
  handleInbound,
  isTrustedSnsUrl,
  parseGraphNotifications,
  parseInbound,
  parseSesInbound,
  parseSnsMessage,
  type SnsVerificationOptions,
  verifySnsMessage,
} from "./inbound.js";

const eml = new Uint8Array(readFileSync(new URL("./__fixtures__/inbound/multipart.eml", import.meta.url)));

const emlText = new TextDecoder("latin1").decode(eml);

const now = 1_760_000_000_000;

const seconds = String(now / 1000);

/** DER helpers for a minimal X.509 certificate around a test key. Only the SPKI matters. */
function der(tag: number, ...content: Buffer[]): Buffer {
  const body = Buffer.concat(content);
  const length = body.length < 0x80 ? Buffer.from([body.length]) : body.length < 0x100 ? Buffer.from([0x81, body.length]) : Buffer.from([0x82, body.length >> 8, body.length & 0xff]);

  return Buffer.concat([Buffer.from([tag]), length, body]);
}

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });

const spki = publicKey.export({ type: "spki", format: "der" });

const algorithm = der(0x30, Buffer.from([0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x0b]), Buffer.from([0x05, 0x00]));

const tbs = der(0x30, der(0xa0, der(0x02, Buffer.from([2]))), der(0x02, Buffer.from([1])), algorithm, der(0x30), der(0x30), der(0x30), spki);

const certificateDer = der(0x30, tbs, algorithm, der(0x03, Buffer.from([0]), Buffer.alloc(16)));

const certificatePem = `-----BEGIN CERTIFICATE-----\n${certificateDer.toString("base64").replace(/.{64}/g, "$&\n")}\n-----END CERTIFICATE-----\n`;

const certUrl = "https://sns.us-east-1.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem";

const topicArn = "arn:aws:sns:us-east-1:123456789012:inbound";

interface SnsFields {
  Type: string;
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
}

function snsSign(fields: SnsFields, version: "1" | "2") {
  const keys = fields.Type === "Notification"
    ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"] as const
    : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"] as const;

  const canonical = keys.flatMap(key => fields[key] === undefined ? [] : [`${key}\n${fields[key]}\n`]).join("");

  return createSign(version === "1" ? "RSA-SHA1" : "RSA-SHA256").update(canonical).sign(privateKey, "base64");
}

function snsBody(message: string, options: { version?: "1" | "2"; type?: string; extra?: Partial<SnsFields> } = {}) {
  const version = options.version ?? "2";

  const fields: SnsFields = {
    Type: options.type ?? "Notification",
    MessageId: "22b80b92-fdea-4c2c-8f9d-bdfb0c7bf324",
    TopicArn: topicArn,
    Message: message,
    Timestamp: "2025-10-06T09:00:00.000Z",
    ...options.extra,
  };

  return JSON.stringify({ ...fields, SignatureVersion: version, Signature: snsSign(fields, version), SigningCertURL: certUrl });
}

function sesNotification(action: Record<string, string>, content?: string) {
  return JSON.stringify({
    notificationType: "Received",
    receipt: {
      recipients: ["support@acme.test"],
      spamVerdict: { status: "PASS" },
      virusVerdict: { status: "PASS" },
      spfVerdict: { status: "PASS" },
      dkimVerdict: { status: "GRAY" },
      dmarcVerdict: { status: "FAIL" },
      action,
    },
    mail: { source: "bounce@example.net", messageId: "ses-msg-1", destination: ["support@acme.test"] },
    content,
  });
}

const signedAt = Date.parse("2025-10-06T09:00:00.000Z");

const certFetch = stubFetch(async input => {
  if (String(input) === certUrl) return new Response(certificatePem);

  return new Response("unexpected", { status: 500 });
});

describe("SNS verification", () => {
  test("extracts the public key from a certificate", () => {
    expect(Buffer.from(certificatePublicKey(certificatePem))).toEqual(spki);
  });

  test("accepts only sns.<region>.amazonaws.com HTTPS URLs", () => {
    expect(isTrustedSnsUrl(certUrl)).toBe(true);
    expect(isTrustedSnsUrl("https://sns.cn-north-1.amazonaws.com.cn/x.pem")).toBe(true);
    expect(isTrustedSnsUrl("http://sns.us-east-1.amazonaws.com/x.pem")).toBe(false);
    expect(isTrustedSnsUrl("https://sns.us-east-1.amazonaws.com.evil.test/x.pem")).toBe(false);
    expect(isTrustedSnsUrl("https://evil.test/sns.us-east-1.amazonaws.com/x.pem")).toBe(false);
    expect(isTrustedSnsUrl("https://sns.us-east-1.amazonaws.com:8443/x.pem")).toBe(false);
  });

  test("verifies SignatureVersion 1 and 2 and rejects tampering", async () => {
    const cache: NonNullable<SnsVerificationOptions["certificateCache"]> = new Map();

    for (const version of ["1", "2"] as const) {
      const message = parseSnsMessage(snsBody("hello", { version }));

      expect(await verifySnsMessage(message, { fetch: certFetch, certificateCache: cache, now: signedAt })).toEqual({ ok: true });
      expect(await verifySnsMessage({ ...message, Message: "changed" }, { fetch: certFetch, certificateCache: cache, now: signedAt })).toEqual({ ok: false, reason: "signature_invalid" });
    }

    const message = parseSnsMessage(snsBody("hello"));

    expect(await verifySnsMessage({ ...message, SigningCertURL: "https://evil.test/cert.pem" }, { fetch: certFetch, now: signedAt })).toEqual({ ok: false, reason: "signature_invalid" });
    expect(await verifySnsMessage(message, { fetch: certFetch, topicArn: "arn:aws:sns:us-east-1:1:other", now: signedAt })).toEqual({ ok: false, reason: "signature_invalid" });
  });

  test("rejects certificate URL variants before fetching and bounds the cache", async () => {
    const message = parseSnsMessage(snsBody("hello"));
    let fetches = 0;

    const countingFetch = stubFetch(async () => {
      fetches += 1;

      return new Response(certificatePem);
    });

    const cache: NonNullable<SnsVerificationOptions["certificateCache"]> = new Map();
    const options = { fetch: countingFetch, certificateCache: cache, topicArn, now: signedAt };

    const variants = [
      ...Array.from({ length: 40 }, (_, index) => `${certUrl}#${index}`),
      `${certUrl}?x=1`,
      "https://user@sns.us-east-1.amazonaws.com/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem",
      "https://sns.us-east-1.amazonaws.com:443/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem",
      "https://sns.us-east-1.amazonaws.com/other/SimpleNotificationService-0123456789abcdef0123456789abcdef.pem",
      "https://sns.us-east-1.amazonaws.com/cert.pem",
    ];

    for (const SigningCertURL of variants) {
      expect(await verifySnsMessage({ ...message, SigningCertURL, Signature: "AAAA" }, options)).toEqual({ ok: false, reason: "signature_invalid" });
    }

    expect(fetches).toBe(0);
    expect(cache.size).toBe(0);

    // A trusted URL with a bad signature is fetched but not cached.
    expect(await verifySnsMessage({ ...message, Message: "forged" }, options)).toEqual({ ok: false, reason: "signature_invalid" });
    expect(cache.size).toBe(0);

    // Many distinct trusted certificates never grow the cache past its bound.
    for (let index = 0; index < 40; index += 1) {
      const SigningCertURL = `https://sns.us-east-1.amazonaws.com/SimpleNotificationService-${index.toString(16).padStart(32, "0")}.pem`;

      expect(await verifySnsMessage({ ...message, SigningCertURL }, options)).toEqual({ ok: true });
    }

    expect(cache.size).toBeLessThanOrEqual(16);

    const before = fetches;

    expect(await verifySnsMessage(message, options)).toEqual({ ok: true });
    expect(await verifySnsMessage(message, options)).toEqual({ ok: true });
    expect(fetches).toBe(before + 1);

    // Entries expire, so a rotated certificate is fetched again.
    expect(await verifySnsMessage(message, { ...options, now: signedAt + 1000, toleranceSeconds: 365 * 86_400 })).toEqual({ ok: true });
    expect(fetches).toBe(before + 1);
    expect(await verifySnsMessage(message, { ...options, now: signedAt + 2 * 86_400_000, toleranceSeconds: 365 * 86_400 })).toEqual({ ok: true });
    expect(fetches).toBe(before + 2);
  });

  test("refuses redirects when fetching certificates and confirming subscriptions", async () => {
    const redirects: (RequestRedirect | undefined)[] = [];

    const fetch = stubFetch(async (input, init) => {
      redirects.push(init?.redirect);

      return String(input) === certUrl ? new Response(certificatePem) : new Response("<ConfirmSubscriptionResponse/>");
    });

    const subscribeUrl = "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=tok";
    const body = snsBody("confirm", { type: "SubscriptionConfirmation", extra: { Token: "tok", SubscribeURL: subscribeUrl } });

    await handleInbound(new Request("https://example.test/ses", { method: "POST", body }), {
      provider: "ses", fetch, topicArn, now: signedAt, certificateCache: new Map(),
    });

    expect(redirects).toEqual(["error", "error"]);
  });

  test("rejects replayed messages outside the window", async () => {
    const message = parseSnsMessage(snsBody("hello"));

    expect(await verifySnsMessage(message, { fetch: certFetch, now: signedAt + 3_599_000 })).toEqual({ ok: true });
    expect(await verifySnsMessage(message, { fetch: certFetch, now: signedAt + 3_601_000 })).toEqual({ ok: false, reason: "timestamp_expired" });
    expect(await verifySnsMessage(message, { fetch: certFetch, now: signedAt + 400_000, toleranceSeconds: 300 })).toEqual({ ok: false, reason: "timestamp_expired" });
    expect(await verifySnsMessage({ ...message, Timestamp: "yesterday" }, { fetch: certFetch, now: signedAt })).toEqual({ ok: false, reason: "timestamp_expired" });
  });
});

describe("SES receiving", () => {
  test("parses an SNS action notification with base64 content and SES verdicts", async () => {
    const body = snsBody(sesNotification({ type: "SNS", topicArn, encoding: "BASE64" }, Buffer.from(eml).toString("base64")));
    const email = await parseSesInbound({ body }, { fetch: certFetch, topicArn, now: signedAt });

    expect(email.id).toBe("ses-msg-1");
    expect(email.subject).toBe("Café order ✉ #42");
    expect(email.envelope).toEqual({ from: "bounce@example.net", to: ["support@acme.test"] });
    expect(email.security).toEqual({ spf: "pass", dkim: "gray", dmarc: "fail", spam: "pass", virus: "pass" });
    expect(email.attachments).toHaveLength(3);
  });

  test("reads S3-stored mail with SigV4 credentials", async () => {
    const body = snsBody(sesNotification({ type: "S3", bucketName: "inbound-mail", objectKey: "mail/abc 1" }));

    const fetch = stubFetch(async (input, init) => {
      if (String(input) === certUrl) return new Response(certificatePem);

      expect(String(input)).toBe("https://inbound-mail.s3.us-east-1.amazonaws.com/mail/abc%201");
      expect(new Headers(init?.headers).get("authorization")).toStartWith("AWS4-HMAC-SHA256 Credential=AKIATEST/");
      expect(new Headers(init?.headers).get("x-amz-content-sha256")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");

      return new Response(eml);
    });

    const s3 = { accessKeyId: "AKIATEST", secretAccessKey: "secret", region: "us-east-1", fetch };

    expect((await parseSesInbound({ body }, { fetch, s3, topicArn, now: signedAt })).messageId).toBe("msg-42@example.net");
    await expect(parseSesInbound({ body }, { fetch, topicArn, now: signedAt })).rejects.toThrow("Pass s3 credentials");
    expect(await fetchSesInboundFromS3({ bucket: "inbound-mail", key: "mail/abc 1" }, s3)).toEqual(eml);
  });

  test("escapes S3 keys the way SigV4 signs them and rejects dot segments", async () => {
    const urls: string[] = [];

    const fetch = stubFetch(async input => {
      urls.push(String(input));

      return new Response(eml);
    });

    const s3 = { accessKeyId: "AKIATEST", secretAccessKey: "secret", region: "us-east-1", fetch };

    await fetchSesInboundFromS3({ bucket: "inbound-mail", key: "archive(1)/inbound!/it's*~.eml" }, s3);
    expect(urls).toEqual(["https://inbound-mail.s3.us-east-1.amazonaws.com/archive%281%29/inbound%21/it%27s%2A~.eml"]);

    for (const key of ["mail/../abc", "./abc", "mail/."]) {
      await expect(fetchSesInboundFromS3({ bucket: "inbound-mail", key }, s3)).rejects.toMatchObject({ reason: "payload_invalid" });
    }

    expect(urls).toHaveLength(1);
  });

  test("rejects S3 objects that SES encrypted with the S3 encryption client", async () => {
    const body = snsBody(sesNotification({ type: "S3", bucketName: "inbound-mail", objectKey: "mail/1" }));

    for (const header of ["x-amz-meta-x-amz-key-v2", "x-amz-meta-x-amz-key"]) {
      const fetch = stubFetch(async input => {
        if (String(input) === certUrl) return new Response(certificatePem);

        return new Response(new Uint8Array([0x8f, 0x01, 0xc3, 0x7a]), {
          headers: { [header]: "AQIDAHh...", "x-amz-meta-x-amz-cek-alg": "AES/GCM/NoPadding", "x-amz-meta-x-amz-wrap-alg": "kms" },
        });
      });

      const s3 = { accessKeyId: "AKIATEST", secretAccessKey: "secret", region: "us-east-1", fetch };

      await expect(parseSesInbound({ body }, { fetch, s3, topicArn, now: signedAt })).rejects.toMatchObject({ reason: "unsupported", provider: "ses" });
      await expect(fetchSesInboundFromS3({ bucket: "inbound-mail", key: "mail/1" }, s3)).rejects.toThrow("encrypted");
    }
  });

  test("uses path-style URLs for dotted bucket names", async () => {
    const urls: string[] = [];

    const fetch = stubFetch(async input => {
      urls.push(String(input));

      return new Response(eml);
    });

    await fetchSesInboundFromS3({ bucket: "inbound.acme", key: "mail/1" }, { accessKeyId: "AKIATEST", secretAccessKey: "secret", region: "eu-west-1", fetch });
    expect(urls).toEqual(["https://s3.eu-west-1.amazonaws.com/inbound.acme/mail/1"]);
  });

  test("downloads S3 mail with the caller's fetch and signal unless s3 overrides them", async () => {
    const body = snsBody(sesNotification({ type: "S3", bucketName: "inbound-mail", objectKey: "mail/1" }));
    const controller = new AbortController();
    const signals: (AbortSignal | null | undefined)[] = [];

    const fetch = stubFetch(async (input, init) => {
      if (String(input) === certUrl) return new Response(certificatePem);

      signals.push(init?.signal);

      return new Response(eml);
    });

    const s3 = { accessKeyId: "AKIATEST", secretAccessKey: "secret", region: "us-east-1" };

    expect((await parseSesInbound({ body }, { fetch, signal: controller.signal, s3, topicArn, now: signedAt })).messageId).toBe("msg-42@example.net");
    expect(signals).toEqual([controller.signal]);

    const override = stubFetch(async () => new Response(eml));

    await parseSesInbound({ body }, { fetch, s3: { ...s3, fetch: override }, topicArn, now: signedAt });
    expect(signals).toHaveLength(1);
  });

  test("rejects unsigned or non-Received messages", async () => {
    const forged = JSON.parse(snsBody(sesNotification({ type: "SNS" }, emlText)));
    forged.Message = sesNotification({ type: "SNS" }, "From: attacker@example.com\r\n\r\nhi");

    await expect(parseSesInbound({ body: JSON.stringify(forged) }, { fetch: certFetch, topicArn, now: signedAt })).rejects.toMatchObject({ reason: "signature_invalid" });
    await expect(parseSesInbound({ body: snsBody('{"notificationType":"Bounce"}') }, { fetch: certFetch, allowAnyTopic: true, now: signedAt })).rejects.toThrow("not a Received notification");
    await expect(parseSesInbound({ body: snsBody('{"notificationType":"Bounce"}') }, { fetch: certFetch, now: signedAt })).rejects.toMatchObject({ reason: "secret_missing" });
    expect(() => parseSnsMessage('{"Type":"Notification"}')).toThrow(InboundError);
  });
});

describe("Microsoft Graph", () => {
  const notification = (clientState?: string) => JSON.stringify({
    value: [{
      subscriptionId: "sub-1",
      changeType: "created",
      clientState,
      resource: "Users/u-1/Messages/AAMk=",
      tenantId: "tenant-1",
      resourceData: { "@odata.type": "#Microsoft.Graph.Message", id: "AAMk=" },
    }],
  });

  test("answers the validation handshake with the token as text/plain", async () => {
    const response = graphValidationResponse("https://example.test/graph?validationToken=Validation%3A%20Testing");

    expect(response?.headers.get("content-type")).toStartWith("text/plain");
    expect(await response?.text()).toBe("Validation: Testing");
    expect(graphValidationResponse("https://example.test/graph")).toBeUndefined();
  });

  test("checks clientState on every notification", () => {
    expect(parseGraphNotifications({ body: notification("state-1") }, { clientState: "state-1" })[0]).toMatchObject({ messageId: "AAMk=", resource: "Users/u-1/Messages/AAMk=" });
    expect(() => parseGraphNotifications({ body: notification("state-2") }, { clientState: "state-1" })).toThrow("does not match");
    expect(() => parseGraphNotifications({ body: notification() }, { clientState: "state-1" })).toThrow("no clientState");
  });

  test("fetches the message as MIME", async () => {
    const fetch = stubFetch(async (input, init) => {
      expect(String(input)).toBe("https://graph.microsoft.com/v1.0/Users/u-1/Messages/AAMk=/$value");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer graph-token");

      return new Response(eml);
    });

    const email = await fetchGraphInboundEmail("Users/u-1/Messages/AAMk=", { getAccessToken: () => "graph-token", fetch });

    expect(email.id).toBe("AAMk=");
    expect(email.subject).toBe("Café order ✉ #42");
    await expect(fetchGraphInboundEmail("https://evil.test/x", { getAccessToken: () => "t", fetch })).rejects.toThrow("Graph resource");
  });
});

describe("handleInbound", () => {
  const post = (body: BodyInit, headers: HeadersInit = {}, url = "https://example.test/inbound") => new Request(url, { method: "POST", body, headers });

  test("verifies, then parses, a signed provider request", async () => {
    const body = JSON.stringify({ messageId: "jet-1", uid: "u1", subject: "Hi", from: "a@x.test", to: "b@x.test" });
    const signature = createHmac("sha256", "jet").update(`id.${seconds}.${body}`).digest("hex");
    const headers = { "x-webhook-id": "id", "x-webhook-timestamp": seconds, "x-webhook-signature": signature };
    const result = await handleInbound(post(body, headers), { provider: "jetemail", secret: "jet", now });

    expect(result.type === "emails" && result.emails[0]?.subject).toBe("Hi");
    await expect(handleInbound(post(body, { ...headers, "x-webhook-signature": "00" }), { provider: "jetemail", secret: "jet", now })).rejects.toMatchObject({ reason: "signature_invalid", provider: "jetemail" });
  });

  test("reads multipart bodies from a real Request (Mailgun)", async () => {
    const form = new FormData();
    const token = "t".repeat(50);
    form.set("timestamp", seconds);
    form.set("token", token);
    form.set("signature", createHmac("sha256", "mg").update(`${seconds}${token}`).digest("hex"));
    form.set("recipient", "support@acme.test");
    form.set("body-plain", "Hello");

    const result = await handleInbound(post(form), { provider: "mailgun", secret: "mg", now });

    expect(result.type === "emails" && result.emails[0]?.text).toBe("Hello");
  });

  test("requires an explicit auth choice for unsigned providers", async () => {
    const body = JSON.stringify({ MessageID: "pm-1", Subject: "Hi", Headers: [], Attachments: [] });
    const basic = { basic: { username: "u", password: "p" } };

    await expect(handleInbound(post(body), { provider: "postmark", auth: basic })).rejects.toMatchObject({ reason: "signature_missing" });

    const ok = await handleInbound(post(body, { authorization: `Basic ${btoa("u:p")}` }), { provider: "postmark", auth: basic });

    expect(ok.type === "emails" && ok.emails[0]?.id).toBe("pm-1");
    expect((await handleInbound(post(body), { provider: "postmark", auth: { none: true } })).type).toBe("emails");
  });

  test("returns Graph handshakes and fetches created messages", async () => {
    const handshake = await handleInbound(post("", {}, "https://example.test/graph?validationToken=abc"), {
      provider: "graph", clientState: "s", api: { getAccessToken: () => "t" },
    });

    expect(handshake.type === "handshake" && (await handshake.response.text())).toBe("abc");

    const fetch = stubFetch(async () => new Response(eml));
    const body = JSON.stringify({ value: [{ subscriptionId: "s1", changeType: "created", clientState: "s", resource: "users/u/messages/m1" }, { subscriptionId: "s1", changeType: "deleted", clientState: "s", resource: "users/u/messages/m0" }] });
    const result = await handleInbound(post(body), { provider: "graph", clientState: "s", api: { getAccessToken: () => "t", fetch } });

    expect(result.type === "emails" && result.emails.map(email => email.id)).toEqual(["m1"]);
  });

  test("refuses the Graph handshake when no clientState is configured", async () => {
    const handshake = post("", {}, "https://example.test/graph?validationToken=abc");

    await expect(handleInbound(handshake, { provider: "graph", clientState: "", api: { getAccessToken: () => "t" } })).rejects.toMatchObject({ reason: "secret_missing", provider: "graph" });
  });

  test("confirms SNS subscriptions only after verifying them", async () => {
    const subscribeUrl = "https://sns.us-east-1.amazonaws.com/?Action=ConfirmSubscription&Token=tok";
    const visited: string[] = [];

    const fetch = stubFetch(async input => {
      visited.push(String(input));

      return String(input) === certUrl ? new Response(certificatePem) : new Response("<ConfirmSubscriptionResponse/>");
    });

    const body = snsBody("confirm", { type: "SubscriptionConfirmation", extra: { Token: "tok", SubscribeURL: subscribeUrl } });
    const result = await handleInbound(post(body), { provider: "ses", fetch, topicArn, now: signedAt });

    await expect(handleInbound(post(body), { provider: "ses", fetch, now: signedAt })).rejects.toMatchObject({ reason: "secret_missing" });

    expect(result.type).toBe("handshake");
    expect(visited).toContain(subscribeUrl);
  });

  test("parseInbound dispatches by provider", async () => {
    const emails = await parseInbound("sparkpost", { body: JSON.stringify([{ msys: { relay_message: { rcpt_to: "a@x.test", content: { subject: "S", headers: [] } } } }]) });

    expect(emails.map(email => email.subject)).toEqual(["S"]);
  });
});

describe("package entrypoint", () => {
  test("exposes inbound helpers only through the inbound subpath", async () => {
    const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();

    expect(manifest.exports["./inbound"]).toEqual({
      types: "./dist/inbound.d.ts",
      import: "./dist/inbound.js",
      require: "./dist/inbound.cjs",
      default: "./dist/inbound.js",
    });

    const root = await import("./index.js");

    expect("handleInbound" in root).toBe(false);
    expect("parseMimeMessage" in root).toBe(false);
  });
});
