import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { EmailRouteError, EmailValidationError } from "@opencoredev/email-sdk";

const testEnv = {
  EMAIL_SDK_TELEMETRY: "0",
  POSTMARK_SERVER_TOKEN: "test-postmark-token",
  SENDGRID_API_KEY: "SG.test",
  EMAIL_PRIMARY: "postmark",
};

const savedEnv = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]));

const realFetch = globalThis.fetch;

const calls: { host: string; body: string }[] = [];

let postmarkStatus = 200;

function fakeProviders(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  calls.push({ host: new URL(url).host, body: String(init?.body) });

  if (url === "https://api.postmarkapp.com/email") {
    return Promise.resolve(
      postmarkStatus === 200
        ? Response.json({ MessageID: "pm_1", To: "ada@example.com", ErrorCode: 0 })
        : Response.json({ ErrorCode: 701, Message: "Service unavailable" }, { status: postmarkStatus }),
    );
  }

  if (url === "https://api.sendgrid.com/v3/mail/send") {
    return Promise.resolve(new Response(null, { status: 202, headers: { "x-message-id": "sg_1" } }));
  }

  return Promise.reject(new Error(`Unexpected request to ${url}`));
}

let send: typeof import("./send");

let client: typeof import("./email");

beforeAll(async () => {
  Object.assign(process.env, testEnv);
  globalThis.fetch = Object.assign(fakeProviders, { preconnect: realFetch.preconnect });
  client = await import("./email");
  send = await import("./send");
});

afterEach(() => {
  calls.length = 0;
  postmarkStatus = 200;
});

afterAll(() => {
  globalThis.fetch = realFetch;

  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("SendGrid to Postmark migration example", () => {
  test("sends through Postmark when it accepts the message", async () => {
    const result = await send.sendPasswordReset("ada@example.com", "https://acme.com/reset/abc");

    expect(result).toMatchObject({ adapter: "postmark", id: "pm_1" });
    expect(calls.map((call) => call.host)).toEqual(["api.postmarkapp.com"]);
    expect(JSON.parse(calls[0].body)).toMatchObject({
      From: "Acme <security@acme.com>",
      To: "ada@example.com",
      Tag: "type:password-reset",
    });
  });

  test("falls back to SendGrid when Postmark returns a 503", async () => {
    postmarkStatus = 503;

    const result = await send.sendPasswordReset("ada@example.com", "https://acme.com/reset/abc");

    expect(result).toMatchObject({ adapter: "sendgrid", id: "sg_1" });
    expect(calls.map((call) => call.host)).toEqual(["api.postmarkapp.com", "api.sendgrid.com"]);
    expect(JSON.parse(calls[1].body)).toMatchObject({
      personalizations: [{ to: [{ email: "ada@example.com" }] }],
      subject: "Reset your Acme password",
      categories: ["password-reset"],
    });
  });

  test("a receipt with fallback turned off stops after Postmark fails", async () => {
    postmarkStatus = 503;

    const failure = await send.sendReceipt("ada@example.com", "ord_123").catch((error) => error);

    expect(failure).toBeInstanceOf(EmailRouteError);
    expect(calls.map((call) => call.host)).toEqual(["api.postmarkapp.com"]);
    expect(JSON.parse(calls[0].body)).toMatchObject({ Metadata: { orderId: "ord_123" } });
  });

  test("rejects a scheduled send before any request, because Postmark has no sendAt", async () => {
    const failure = await client.email
      .send({
        from: "Acme <hello@acme.com>",
        to: "ada@example.com",
        subject: "Tomorrow",
        text: "Scheduled",
        sendAt: new Date(Date.now() + 86_400_000),
      })
      .catch((error) => error);

    expect(failure).toBeInstanceOf(EmailValidationError);
    expect(String(failure.message)).toContain("postmark");
    expect(calls).toEqual([]);
  });
});
