import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";

import { EmailRouteError, EmailValidationError } from "@opencoredev/email-sdk";

const realFetch = globalThis.fetch;

const calls: string[] = [];

let resendStatus = 200;

function fakeProviders(input: RequestInfo | URL): Promise<Response> {
  const url = String(input);
  calls.push(new URL(url).host);

  if (url === "https://api.resend.com/emails") {
    return Promise.resolve(
      resendStatus === 200
        ? Response.json({ id: "re_1" })
        : Response.json({ message: "Service unavailable" }, { status: resendStatus }),
    );
  }

  if (url === "https://api.mailgun.net/v3/mg.acme.com/messages") {
    return Promise.resolve(Response.json({ id: "<mg_1@mg.acme.com>", message: "Queued. Thank you." }));
  }

  return Promise.reject(new Error(`Unexpected request to ${url}`));
}

let send: typeof import("./send");

let client: typeof import("./email");

beforeAll(async () => {
  process.env.EMAIL_SDK_TELEMETRY = "0";
  process.env.RESEND_API_KEY = "re_test";
  process.env.MAILGUN_API_KEY = "test-mailgun-key";
  process.env.MAILGUN_DOMAIN = "mg.acme.com";
  delete process.env.MAILGUN_BASE_URL;
  process.env.EMAIL_PRIMARY = "resend";
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
});

describe("Mailgun to Resend migration example", () => {
  test("sends through Resend when it accepts the message", async () => {
    const result = await send.sendMagicLink("ada@example.com", "https://acme.com/login/abc");

    expect(result).toMatchObject({ adapter: "resend", id: "re_1" });
    expect(calls).toEqual(["api.resend.com"]);
  });

  test("falls back to Mailgun when Resend returns a 503", async () => {
    resendStatus = 503;

    const result = await send.sendMagicLink("ada@example.com", "https://acme.com/login/abc");

    expect(result).toMatchObject({ adapter: "mailgun", id: "<mg_1@mg.acme.com>" });
    expect(calls).toEqual(["api.resend.com", "api.mailgun.net"]);
  });

  test("a receipt with fallback turned off stops after Resend fails", async () => {
    resendStatus = 503;

    const failure = await send.sendReceipt("ada@example.com", "ord_123").catch((error) => error);

    expect(failure).toBeInstanceOf(EmailRouteError);
    expect(calls).toEqual(["api.resend.com"]);
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
