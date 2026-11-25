import { describe, expect, test } from "bun:test";
import { EmailAdapterError, EmailValidationError } from "./errors.js";
import { nightmail } from "./nightmail.js";
import type { JsonValue } from "./internal/decode.js";
import { parseJsonStrict } from "./internal/decode.js";
import type { EmailMessage } from "./types.js";
import { base64, context } from "../test-support/adapter-fixtures.js";
import { rejectionOf } from "../test-support/assertions.js";
import { expectPerSendAuth } from "../test-support/credential-rotation.js";
import { stubFetch } from "../test-support/fetch.js";

const queued = { id: "em_123", status: "queued", simulated: false };

const base: EmailMessage = {
  from: "hello@acme.test",
  to: "ada@example.com",
  subject: "Hi",
  text: "Hi",
};

type Call = { url: string; headers: Headers; json: JsonValue };

/** Answers attachment uploads with att_<n> and sends with `send`. */
function nightmailFetch(send: () => Response = () => Response.json(queued, { status: 202 })) {
  const calls: Call[] = [];
  let uploads = 0;

  const fetch = stubFetch(async (input, init) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers), json: parseJsonStrict(String(init?.body)) });

    if (url.endsWith("/v1/attachments")) {
      uploads += 1;

      return Response.json({ id: `att_${uploads}`, filename: "f", contentType: "text/plain", size: 1 }, { status: 201 });
    }

    return send();
  });

  return { calls, fetch };
}

const apiError = (status: number, code: string, retryable: boolean) =>
  Response.json({ error: { code, message: "Request refused", requestId: "req_1", retryable } }, { status });

describe("Nightmail adapter", () => {
  test("maps normalized fields to POST /v1/emails/send", async () => {
    const capture = nightmailFetch();

    const response = await nightmail({ apiKey: "nm_key", fetch: capture.fetch }).send(
      {
        from: "Acme <hello@acme.test>",
        to: ["ada@example.com", { email: "grace@example.com" }],
        cc: "cc@example.com",
        bcc: ["bcc@example.com"],
        replyTo: "reply@acme.test",
        subject: "Welcome",
        text: "Hello",
        html: "<p>Hello</p>",
        headers: { "X-Test": "yes" },
        sendAt: "2026-12-01T09:00:00+01:00",
      },
      context,
    );

    expect(response).toMatchObject({ adapter: "nightmail", id: "em_123", raw: queued });
    expect(capture.calls).toHaveLength(1);
    expect(capture.calls[0]?.url).toBe("https://nightmail.dev/v1/emails/send");
    expect(capture.calls[0]?.headers.get("authorization")).toBe("Bearer nm_key");
    expect(capture.calls[0]?.headers.get("idempotency-key")).toBe("idem_123");
    expect(capture.calls[0]?.json).toEqual({
      from: "hello@acme.test",
      fromName: "Acme",
      to: ["ada@example.com", "grace@example.com"],
      cc: ["cc@example.com"],
      bcc: ["bcc@example.com"],
      replyTo: ["reply@acme.test"],
      subject: "Welcome",
      html: "<p>Hello</p>",
      text: "Hello",
      headers: [{ name: "X-Test", value: "yes" }],
      scheduledAt: "2026-12-01T08:00:00.000Z",
    });
  });

  test("omits empty optional fields and honors a self-hosted baseUrl", async () => {
    const capture = nightmailFetch();

    await nightmail({ apiKey: "nm_key", baseUrl: "https://mail.example.org/", fetch: capture.fetch }).send(
      { ...base, html: "" },
      { ...context, idempotencyKey: undefined },
    );

    expect(capture.calls[0]?.url).toBe("https://mail.example.org/v1/emails/send");
    expect(capture.calls[0]?.headers.has("idempotency-key")).toBe(false);
    expect(capture.calls[0]?.json).toEqual({ from: "hello@acme.test", to: ["ada@example.com"], subject: "Hi", text: "Hi" });
  });

  test("uploads attachments first and sends their ids", async () => {
    const capture = nightmailFetch();

    await nightmail({ apiKey: "nm_key", fetch: capture.fetch }).send(
      {
        ...base,
        attachments: [
          { filename: "hello.txt", content: "hello", contentType: "text/plain" },
          { filename: "logo.png", content: "png", contentType: "image/png", contentId: "logo" },
        ],
      },
      context,
    );

    expect(capture.calls.map((call) => call.url)).toEqual([
      "https://nightmail.dev/v1/attachments",
      "https://nightmail.dev/v1/attachments",
      "https://nightmail.dev/v1/emails/send",
    ]);
    expect(capture.calls[0]?.json).toEqual({
      filename: "hello.txt",
      content: base64("hello"),
      contentType: "text/plain",
      disposition: "attachment",
    });
    expect(capture.calls[1]?.json).toEqual({
      filename: "logo.png",
      content: base64("png"),
      contentType: "image/png",
      disposition: "inline",
      contentId: "logo",
    });
    expect(capture.calls[2]?.json).toMatchObject({ attachments: ["att_1", "att_2"] });
  });

  test("derives stable per-attachment idempotency keys so a retry replays the same uploads", async () => {
    const keys = async (idempotencyKey: string | undefined) => {
      const capture = nightmailFetch();
      await nightmail({ apiKey: "nm_key", fetch: capture.fetch }).send(
        { ...base, attachments: [{ filename: "a.txt", content: "a" }, { filename: "b.txt", content: "b" }] },
        { ...context, idempotencyKey },
      );

      return capture.calls.map((call) => call.headers.get("idempotency-key"));
    };

    const first = await keys("idem_123");
    expect(first).toEqual(await keys("idem_123"));
    expect(first[0]).toMatch(/^att-[0-9a-f]{64}$/);
    expect(first[1]).toMatch(/^att-[0-9a-f]{64}$/);
    expect(first[0]).not.toBe(first[1]);
    expect(first[2]).toBe("idem_123");
    expect((await keys("idem_456"))[0]).not.toBe(first[0]);
    expect(await keys(undefined)).toEqual([null, null, null]);
  });

  test("a static Idempotency-Key header is resolved once and never reused across uploads", async () => {
    const capture = nightmailFetch();

    await nightmail({ apiKey: "nm_key", headers: { "idempotency-key": "static_1" }, fetch: capture.fetch }).send(
      { ...base, attachments: [{ filename: "a.txt", content: "a" }, { filename: "b.txt", content: "b" }] },
      { ...context, idempotencyKey: undefined },
    );

    const keys = capture.calls.map((call) => call.headers.get("idempotency-key"));

    expect(keys[2]).toBe("static_1");
    expect(new Set(keys).size).toBe(3);
  });

  test("hashes idempotency keys Nightmail would refuse", async () => {
    const sendKey = async (idempotencyKey: string) => {
      const capture = nightmailFetch();
      await nightmail({ apiKey: "nm_key", fetch: capture.fetch }).send(base, { ...context, idempotencyKey });

      return capture.calls[0]?.headers.get("idempotency-key");
    };

    const long = `order-1:${"x".repeat(200)}@example.com`;
    expect(await sendKey(long)).toMatch(/^sdk-[0-9a-f]{64}$/);
    expect(await sendKey(long)).toBe(await sendKey(long));
    expect(await sendKey("order 1")).toMatch(/^sdk-[0-9a-f]{64}$/);
    expect(await sendKey("x".repeat(200))).toBe("x".repeat(200));
  });

  test("reports Nightmail's error code, request id, and retryable flag", async () => {
    const adapter = (response: Response) =>
      nightmail({ apiKey: "nm_key", fetch: nightmailFetch(() => response).fetch });

    const rejected = await rejectionOf(
      adapter(apiError(422, "RECIPIENT_INELIGIBLE", false)).send(base, context),
      EmailAdapterError,
    );

    expect(rejected).toMatchObject({ status: 422, retryable: false, delivery: "not_sent" });
    expect(rejected.message).toBe("Nightmail failed with 422: Request refused (RECIPIENT_INELIGIBLE, request req_1)");

    const screen = await rejectionOf(
      adapter(apiError(503, "CONTENT_SCREEN_UNAVAILABLE", true)).send(base, context),
      EmailAdapterError,
    );

    expect(screen).toMatchObject({ status: 503, retryable: true, delivery: "unknown" });

    const conflict = await rejectionOf(
      adapter(apiError(409, "IDEMPOTENCY_CONFLICT", false)).send(base, context),
      EmailAdapterError,
    );

    expect(conflict).toMatchObject({ status: 409, retryable: false, delivery: "unknown" });

    const limited = await rejectionOf(
      adapter(apiError(429, "RAMP_LIMIT_REACHED", true)).send(base, context),
      EmailAdapterError,
    );

    expect(limited).toMatchObject({ status: 429, retryable: true, delivery: "not_sent" });
  });

  test("a failed attachment upload never submits the email", async () => {
    const calls: string[] = [];

    const fetch = stubFetch(async (input) => {
      calls.push(String(input));

      return apiError(500, "INTERNAL", true);
    });

    const error = await rejectionOf(
      nightmail({ apiKey: "nm_key", fetch }).send({ ...base, attachments: [{ filename: "a.txt", content: "a" }] }, context),
      EmailAdapterError,
    );

    expect(calls).toEqual(["https://nightmail.dev/v1/attachments"]);
    expect(error).toMatchObject({ status: 500, retryable: true, delivery: "not_sent" });
    expect(error.message).toContain("while uploading attachment a.txt");
  });

  test.each([
    ["no email id", { status: "queued" }, 202],
    ["a status other than queued", { id: "em_1", status: "failed" }, 202],
    ["a 200 instead of 202", queued, 200],
  ] as const)("treats a success with %s as an unknown outcome", async (_, body, status) => {
    const error = await rejectionOf(
      nightmail({
        apiKey: "nm_key",
        fetch: nightmailFetch(() => Response.json(body, { status })).fetch,
      }).send(base, context),
      EmailAdapterError,
    );

    expect(error).toMatchObject({ status, retryable: false, delivery: "unknown" });
  });

  test("a transport failure during an upload is not_sent, so fallback can try another adapter", async () => {
    const calls: string[] = [];

    const fetch = stubFetch(async (input) => {
      calls.push(String(input));

      throw new TypeError("fetch failed");
    });

    const error = await rejectionOf(
      nightmail({ apiKey: "nm_key", fetch }).send({ ...base, attachments: [{ filename: "a.txt", content: "a" }] }, context),
      EmailAdapterError,
    );

    expect(calls).toEqual(["https://nightmail.dev/v1/attachments"]);
    expect(error).toMatchObject({ delivery: "not_sent" });
  });

  test("rejects recipient display names and limits Nightmail would refuse", async () => {
    const capture = nightmailFetch();
    const adapter = nightmail({ apiKey: "nm_key", fetch: capture.fetch });
    const many = (count: number) => Array.from({ length: count }, (_, index) => `r${index}@example.com`);

    for (const message of [
      { ...base, to: "Ada <ada@example.com>" },
      { ...base, cc: [{ email: "cc@example.com", name: "Cc" }] },
      { ...base, replyTo: "Support <support@acme.test>" },
      { ...base, to: many(51) },
      { ...base, cc: many(50) },
      { ...base, bcc: many(50) },
      { ...base, replyTo: many(11) },
      { ...base, headers: Object.fromEntries(many(16).map((name, index) => [`X-H${index}`, name])) },
      { ...base, tags: [{ name: "kind", value: "welcome" }] },
      { ...base, metadata: { userId: "u_1" } },
    ] satisfies EmailMessage[]) {
      await rejectionOf(adapter.send(message, context), EmailValidationError);
    }

    expect(capture.calls).toHaveLength(0);
  });

  test("declares native idempotency and scheduling", () => {
    expect(nightmail({ apiKey: "nm_key" }).capabilities).toMatchObject({
      idempotency: "native",
      scheduling: true,
      repeatedHeaders: false,
    });
  });

  test("reads the API key on every send", async () => {
    await expectPerSendAuth((options) => nightmail(options), base, queued, { status: 202 });
  });
});
