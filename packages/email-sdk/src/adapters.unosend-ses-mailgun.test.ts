import { afterEach, describe, expect, setSystemTime, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { EmailValidationError } from "./errors.js";
import { mailgun } from "./mailgun.js";
import { ses } from "./ses.js";
import { unosend } from "./unosend.js";
import {
  base64,
  context,
  formCapture,
  jsonCapture,
  message,
  messageWithoutMetadata,
} from "../test-support/adapter-fixtures.js";
import { stubFetch } from "../test-support/fetch.js";

describe("provider payloads", () => {
  test("Unosend maps REST payloads and response IDs", async () => {
    const capture = jsonCapture({
      success: true,
      data: {
        id: "uno_123",
        status: "queued",
      },
    });

    const response = await unosend({
      apiKey: "un_test",
      fetch: capture.fetch,
    }).send(messageWithoutMetadata, context);

    expect(response.id).toBe("uno_123");
    expect(response.id).toBe("uno_123");
    expect(capture.calls[0]?.url).toBe("https://api.unosend.co/emails");
    expect(capture.calls[0]?.headers.get("authorization")).toBe("Bearer un_test");
    expect(capture.calls[0]?.json).toMatchObject({
      from: "Acme <hello@example.com>",
      to: ["Ada <ada@example.com>"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      reply_to: "reply@example.com",
      subject: "Welcome",
      text: "Hello",
      html: "<p>Hello</p>",
      headers: { "X-Test": "yes" },
      tags: [{ name: "kind", value: "welcome" }],
    });
    expect(capture.calls[0]?.json.attachments[0]).toEqual({
      filename: "hello.txt",
      content: base64("hello"),
      content_type: "text/plain",
    });
  });

  test("Unosend surfaces provider envelope errors", async () => {
    await expect(
      unosend({
        apiKey: "un_test",
        fetch: jsonCapture({
          success: false,
          error: {
            code: "domain_not_verified",
            message: "Sending domain is not verified.",
            status: 400,
          },
        }).fetch,
      }).send(messageWithoutMetadata, context),
    ).rejects.toThrow("unosend failed: Sending domain is not verified.");
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

    expect(response.id).toBe("ses_123");
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

  test("Mailgun batch sending attaches recipient-variables for one personalized call", async () => {
    const capture = formCapture({ id: "<mailgun_batch>" });
    const provider = mailgun({ apiKey: "mg", domain: "mg.example.com", fetch: capture.fetch });

    expect(provider.sendPersonalized).toBeDefined();
    await provider.sendPersonalized?.(
      {
        message: {
          from: "Acme <hello@acme.com>",
          subject: "Hi %recipient.name%",
          html: "<p>Hi %recipient.name%</p>",
        },
        recipients: [
          { to: "a@example.com", variables: { name: "Ada", id: "u_1" } },
          { to: "b@example.com", variables: { name: "Linus", id: "u_2" } },
        ],
      },
      context,
    );

    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0]?.form.getAll("to")).toEqual(["a@example.com", "b@example.com"]);
    expect(capture.calls[0]?.form.get("subject")).toBe("Hi %recipient.name%");
    expect(JSON.parse(String(capture.calls[0]?.form.get("recipient-variables")))).toEqual({
      "a@example.com": { name: "Ada", id: "u_1" },
      "b@example.com": { name: "Linus", id: "u_2" },
    });
  });

  test("Mailgun batch sending rejects more than 1000 recipients", async () => {
    const capture = formCapture({ id: "<mailgun_batch>" });
    const provider = mailgun({ apiKey: "mg", domain: "mg.example.com", fetch: capture.fetch });
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

type SignedRequest = { url: string; headers: Headers; body: string };

function signedCapture() {
  const requests: SignedRequest[] = [];

  const fetch = stubFetch(async (input, init) => {
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body: String(init?.body),
    });

    return new Response('{"MessageId":"ses_1"}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  return { requests, fetch };
}

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const hmac = (key: string | Buffer, value: string) =>
  createHmac("sha256", key).update(value).digest();

/** SigV4 written straight from the AWS spec with node:crypto, independent of the adapter. */
function expectedAuthorization(
  request: SignedRequest,
  secret: string,
  region: string,
  accessKeyId = "AKID",
) {
  const url = new URL(request.url);
  const amzDate = request.headers.get("x-amz-date") ?? "";
  const dateStamp = amzDate.slice(0, 8);

  const signed = [...request.headers.entries(), ["host", url.host]]
    .flatMap(([name = "", value = ""]) =>
      // AWS: trim each value and convert sequential spaces to a single space.
      name === "authorization" ? [] : [[name.toLowerCase(), value.trim().split(/\s+/).join(" ")]],
    )
    .sort(([left = ""], [right = ""]) => (left < right ? -1 : left > right ? 1 : 0));

  const signedHeaders = signed.map(([name]) => name).join(";");

  const canonicalRequest = [
    "POST",
    url.pathname,
    "",
    signed.map(([name, value]) => `${name}:${value}\n`).join(""),
    signedHeaders,
    sha256(request.body),
  ].join("\n");

  const scope = `${dateStamp}/${region}/ses/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${secret}`, dateStamp), region), "ses"), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");

  return `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
}

afterEach(() => {
  setSystemTime();
});

describe("SES SigV4 signing", () => {
  test("matches an independent SigV4 signature, including after the UTC date changes", async () => {
    const { requests, fetch } = signedCapture();

    const adapter = ses({
      accessKeyId: "AKID",
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY",
      sessionToken: "session-token",
      region: "eu-west-1",
      fetch,
    });

    setSystemTime(new Date("2026-03-01T23:59:58.000Z"));
    await adapter.send(messageWithoutMetadata, context);
    await adapter.send(messageWithoutMetadata, context);
    setSystemTime(new Date("2026-03-02T00:00:01.000Z"));
    await adapter.send(messageWithoutMetadata, context);

    expect(requests.map((request) => request.headers.get("x-amz-date"))).toEqual([
      "20260301T235958Z",
      "20260301T235958Z",
      "20260302T000001Z",
    ]);

    for (const request of requests) {
      expect(request.headers.get("x-amz-content-sha256")).toBe(sha256(request.body));
      expect(request.headers.get("authorization")).toBe(
        expectedAuthorization(request, "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "eu-west-1"),
      );
    }
  });

  test("uses rotated credentials on the next send, including a new secret the same day", async () => {
    const { requests, fetch } = signedCapture();

    const options = {
      accessKeyId: "OLD-ID",
      secretAccessKey: "old-secret",
      sessionToken: "old-session",
      region: "eu-west-1",
      fetch,
    };

    const adapter = ses(options);

    setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
    await adapter.send(messageWithoutMetadata, context);
    options.accessKeyId = "NEW-ID";
    options.secretAccessKey = "new-secret";
    options.sessionToken = "new-session";
    await adapter.send(messageWithoutMetadata, context);
    options.secretAccessKey = "old-secret";
    await adapter.send(messageWithoutMetadata, context);

    expect(requests.map((request) => request.headers.get("x-amz-security-token"))).toEqual([
      "old-session",
      "new-session",
      "new-session",
    ]);
    expect(requests.map((request) => request.headers.get("authorization"))).toEqual(
      [
        ["old-secret", "OLD-ID"],
        ["new-secret", "NEW-ID"],
        ["old-secret", "NEW-ID"],
      ].map(([secret = "", accessKeyId = ""], index) =>
        requests[index]
          ? expectedAuthorization(requests[index], secret, "eu-west-1", accessKeyId)
          : "",
      ),
    );
  });

  test("signs concurrent sends correctly while the secret alternates", async () => {
    const { requests, fetch } = signedCapture();

    const secrets = new Map([
      ["ID-0", "secret-0"],
      ["ID-1", "secret-1"],
    ]);

    let reads = 0;
    let lastId = "ID-0";

    const adapter = ses({
      // Each send reads accessKeyId and then secretAccessKey, so the pair stays matched.
      get accessKeyId() {
        lastId = `ID-${reads++ % 2}`;

        return lastId;
      },
      get secretAccessKey() {
        return secrets.get(lastId) ?? "";
      },
      region: "eu-west-1",
      fetch,
    });

    setSystemTime(new Date("2026-03-01T12:00:00.000Z"));
    await Promise.all(
      Array.from({ length: 6 }, () => adapter.send(messageWithoutMetadata, context)),
    );

    expect(requests).toHaveLength(6);

    for (const request of requests) {
      const accessKeyId =
        /Credential=([^/]+)\//.exec(request.headers.get("authorization") ?? "")?.[1] ?? "";

      expect(secrets.has(accessKeyId)).toBe(true);
      expect(request.headers.get("authorization")).toBe(
        expectedAuthorization(request, secrets.get(accessKeyId) ?? "", "eu-west-1", accessKeyId),
      );
    }
  });

  test("collapses repeated spaces in native header values the way AWS does", async () => {
    const { requests, fetch } = signedCapture();
    setSystemTime(new Date("2026-03-01T12:00:00.000Z"));

    await ses({ accessKeyId: "AKID", secretAccessKey: "secret", region: "eu-west-1", fetch }).send(
      messageWithoutMetadata,
      { ...context, native: { headers: { "X-Note": "one  two \t three", "X-Quoted": '"a   b"' } } },
    );

    const [request] = requests;

    if (!request) throw new Error("Expected one SES request.");

    expect(request.headers.get("x-note")).toBe("one  two \t three");
    expect(request.headers.get("authorization")).toBe(
      expectedAuthorization(request, "secret", "eu-west-1"),
    );
  });

  test("rejects native headers the signer owns, whatever their case", async () => {
    const { requests, fetch } = signedCapture();
    const adapter = ses({ accessKeyId: "AKID", secretAccessKey: "secret", region: "eu-west-1", fetch });

    for (const name of [
      "Authorization",
      "X-Amz-Date",
      "x-amz-security-token",
      "X-AMZ-CONTENT-SHA256",
      "Host",
    ]) {
      await expect(
        adapter.send(messageWithoutMetadata, { ...context, native: { headers: { [name]: "native" } } }),
      ).rejects.toThrow(new EmailValidationError(
        `ses sets "${name}" itself, so native.headers can't set it.`,
      ));
    }

    expect(requests).toHaveLength(0);
  });

  test("a native header the signer doesn't own still matches an independent signature", async () => {
    const { requests, fetch } = signedCapture();
    setSystemTime(new Date("2026-03-01T12:00:00.000Z"));

    await ses({ accessKeyId: "AKID", secretAccessKey: "secret", region: "eu-west-1", sessionToken: "tok", fetch }).send(
      messageWithoutMetadata,
      { ...context, native: { headers: { "X-Trace": "1" } } },
    );

    const [request] = requests;

    if (!request) throw new Error("Expected one SES request.");

    expect(request.headers.get("x-amz-security-token")).toBe("tok");
    expect(request.headers.get("authorization")).toBe(
      expectedAuthorization(request, "secret", "eu-west-1"),
    );
  });
});
