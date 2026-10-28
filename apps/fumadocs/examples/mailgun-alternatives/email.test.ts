import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { EmailRouteError, EmailValidationError } from "@opencoredev/email-sdk";

const testEnv = {
  EMAIL_SDK_TELEMETRY: "0",
  RESEND_API_KEY: "re_test",
  MAILGUN_API_KEY: "test-mailgun-key",
  MAILGUN_DOMAIN: "mg.acme.com",
  MAILGUN_BASE_URL: "https://api.eu.mailgun.net",
  EMAIL_PRIMARY: "resend",
};

const savedEnv = Object.fromEntries(Object.keys(testEnv).map((key) => [key, process.env[key]]));

const realFetch = globalThis.fetch;

const calls: { host: string; body: RequestInit["body"] }[] = [];

let resendStatus = 200;

function fakeProviders(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  calls.push({ host: new URL(url).host, body: init?.body });

  if (url === "https://api.resend.com/emails") {
    return Promise.resolve(
      resendStatus === 200
        ? Response.json({ id: "re_1" })
        : Response.json({ message: "Service unavailable" }, { status: resendStatus }),
    );
  }

  if (url === "https://api.eu.mailgun.net/v3/mg.acme.com/messages") {
    return Promise.resolve(Response.json({ id: "<mg_1@mg.acme.com>", message: "Queued. Thank you." }));
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
  resendStatus = 200;
});

afterAll(() => {
  globalThis.fetch = realFetch;

  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe("Mailgun to Resend migration example", () => {
  test("sends through Resend when it accepts the message", async () => {
    const result = await send.sendMagicLink("ada@example.com", "https://acme.com/login/abc");

    expect(result).toMatchObject({ adapter: "resend", id: "re_1" });
    expect(calls.map((call) => call.host)).toEqual(["api.resend.com"]);
    expect(JSON.parse(String(calls[0].body))).toMatchObject({
      from: "Acme <login@mg.acme.com>",
      to: ["ada@example.com"],
      tags: [{ name: "type", value: "magic-link" }],
    });
  });

  test("falls back to Mailgun's EU endpoint when Resend returns a 503", async () => {
    resendStatus = 503;

    const result = await send.sendMagicLink("ada@example.com", "https://acme.com/login/abc");

    expect(result).toMatchObject({ adapter: "mailgun", id: "<mg_1@mg.acme.com>" });
    expect(calls.map((call) => call.host)).toEqual(["api.resend.com", "api.eu.mailgun.net"]);

    const form = calls[1].body;

    expect(form).toBeInstanceOf(FormData);

    if (!(form instanceof FormData)) return;

    expect(form.getAll("to")).toEqual(["ada@example.com"]);
    expect(form.get("subject")).toBe("Your Acme sign-in link");
    expect(form.getAll("o:tag")).toEqual(["magic-link"]);
  });

  test("a receipt with fallback turned off stops after Resend fails", async () => {
    resendStatus = 503;

    const failure = await send.sendReceipt("ada@example.com", "ord_123").catch((error) => error);

    expect(failure).toBeInstanceOf(EmailRouteError);
    expect(calls.map((call) => call.host)).toEqual(["api.resend.com"]);
    expect(JSON.parse(String(calls[0].body))).toMatchObject({
      tags: [{ name: "order", value: "ord_123" }],
    });
  });

  test("rejects Mailgun-style metadata before any request, because Resend has no metadata field", async () => {
    const failure = await client.email
      .send({
        from: "Acme <hello@mg.acme.com>",
        to: "ada@example.com",
        subject: "Welcome",
        text: "Hi",
        metadata: { userId: "user_123" },
      })
      .catch((error) => error);

    expect(failure).toBeInstanceOf(EmailValidationError);
    expect(String(failure.message)).toContain("resend");
    expect(calls).toEqual([]);
  });
});
