import { describe, expect, test } from "bun:test";
import { componentsGeneric, defineSchema, httpRouter, makeFunctionReference } from "convex/server";
import type { ApiFromModules } from "convex/server";
import { convexTest } from "convex-test";

import { registerConvexEmail } from "../testing.js";
import {
  ConvexEmail,
  mailgunWebhookVerifier,
  postmarkBasicAuthVerifier,
  resendWebhookVerifier,
  verifyByProvider,
  type ConvexEmailPublicAuthorizer,
  type ConvexEmailWebhookRequest,
} from "./index.js";

const message = {
  from: "Acme <hello@example.com>",
  to: "ada@example.com",
  subject: "Welcome",
  text: "Your account is ready.",
  adapters: [{ kind: "memory" as const }],
  adapter: "memory",
};

const resendSecretBytes = new Uint8Array(32).fill(7);

const resendSecret = `whsec_${Buffer.from(resendSecretBytes).toString("base64")}`;

const mailgunSecret = "mailgun-signing-key";

function convexEmailComponent() {
  const component = componentsGeneric().convexEmail;

  if (!component) {
    throw new Error("The convexEmail component reference is missing.");
  }

  return component;
}

const email = new ConvexEmail(convexEmailComponent());

const publicApi = email.exposeApi();

function createRouter() {
  const http = httpRouter();

  email.registerRoutes(http, {
    providers: ["resend", "mailgun", "postmark"],
    verify: verifyByProvider({
      resend: resendWebhookVerifier({ secret: resendSecret }),
      mailgun: mailgunWebhookVerifier({ secret: mailgunSecret }),
      postmark: postmarkBasicAuthVerifier({ username: "hooks", password: "s3cret" }),
    }),
  });

  return http;
}

const router = createRouter();

type AppApi = ApiFromModules<{ emails: typeof publicApi }>["emails"];

/** References to the app functions below, called through Convex like a real client would. */
const app: AppApi = {
  send: makeFunctionReference("emails:send"),
  sendBatch: makeFunctionReference("emails:sendBatch"),
  status: makeFunctionReference("emails:status"),
  listEvents: makeFunctionReference("emails:listEvents"),
  cancel: makeFunctionReference("emails:cancel"),
  retry: makeFunctionReference("emails:retry"),
};

const appModules = {
  "./app/_generated/api.ts": async () => ({}),
  "./app/emails.ts": async () => publicApi,
  "./app/http.ts": async () => ({ default: router }),
};

function createTest() {
  const t = convexTest(defineSchema({}), appModules);

  registerConvexEmail(t);

  return t;
}

async function hmacBase64(key: Uint8Array<ArrayBuffer>, content: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(content));

  return Buffer.from(signature).toString("base64");
}

async function hmacHex(key: string, content: string) {
  const encoder = new TextEncoder();

  const cryptoKey = await crypto.subtle.importKey("raw", encoder.encode(key), { name: "HMAC", hash: "SHA-256" }, false, [
    "sign",
  ]);

  const signature = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(content));

  return Buffer.from(signature).toString("hex");
}

async function signedResendHeaders(id: string, body: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmacBase64(resendSecretBytes, `${id}.${timestamp}.${body}`);

  return { "svix-id": id, "svix-timestamp": timestamp, "svix-signature": `v1,${signature}` };
}

async function signedMailgunBody(token: string) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = await hmacHex(mailgunSecret, `${timestamp}${token}`);

  return JSON.stringify({
    signature: { timestamp, token, signature },
    "event-data": { id: token, event: "delivered", message: { headers: { "message-id": "mg-1" } } },
  });
}

function webhookInput(provider: string, headers: Record<string, string>, body = "{}"): ConvexEmailWebhookRequest {
  return { provider, headers, body, request: new Request("https://example.test/email/webhooks", { method: "POST" }) };
}

describe("ConvexEmail.registerRoutes", () => {
  test("refuses to register routes without a verifier", () => {
    expect(() => email.registerRoutes(httpRouter())).toThrow("registerRoutes() requires a webhook verifier");
    expect(() => email.registerRoutes(httpRouter(), { unsafeAllowUnverifiedWebhooks: false })).toThrow(
      "requires a webhook verifier",
    );
  });

  test("registers unverified routes only with the explicit unsafe opt-in", async () => {
    const http = httpRouter();
    const originalWarn = console.warn;
    const warnings: string[] = [];

    console.warn = (text: string) => {
      warnings.push(text);
    };

    try {
      email.registerRoutes(http, { unsafeAllowUnverifiedWebhooks: true });
    } finally {
      console.warn = originalWarn;
    }

    expect(http.lookup("/email/webhooks/resend", "POST")).not.toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("unverified");
  });

  test("records a correctly signed Resend webhook", async () => {
    const t = createTest();
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "msg_1" } });

    const response = await t.fetch("/email/webhooks/resend", {
      method: "POST",
      headers: await signedResendHeaders("evt_signed", body),
      body,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  test("rejects a Resend webhook with a missing or forged signature", async () => {
    const t = createTest();
    const body = JSON.stringify({ type: "email.delivered", data: { email_id: "msg_1" } });

    const unsigned = await t.fetch("/email/webhooks/resend", { method: "POST", body });
    const forgedHeaders = await signedResendHeaders("evt_forged", body);

    const forged = await t.fetch("/email/webhooks/resend", {
      method: "POST",
      headers: forgedHeaders,
      body: body.replace("delivered", "bounced"),
    });

    expect(unsigned.status).toBe(401);
    expect(forged.status).toBe(401);
  });

  test("records a correctly signed Mailgun webhook and rejects a tampered one", async () => {
    const t = createTest();
    const body = await signedMailgunBody("token_1");

    const accepted = await t.fetch("/email/webhooks/mailgun", { method: "POST", body });
    const rejected = await t.fetch("/email/webhooks/mailgun", { method: "POST", body: body.replace("token_1", "token_2") });

    expect(accepted.status).toBe(200);
    expect(rejected.status).toBe(401);
  });

  test("checks Postmark basic auth credentials", async () => {
    const t = createTest();
    const body = JSON.stringify({ RecordType: "Delivery", MessageID: "pm-1", ID: 42 });

    const accepted = await t.fetch("/email/webhooks/postmark", {
      method: "POST",
      headers: { authorization: `Basic ${btoa("hooks:s3cret")}` },
      body,
    });

    const wrongPassword = await t.fetch("/email/webhooks/postmark", {
      method: "POST",
      headers: { authorization: `Basic ${btoa("hooks:guess")}` },
      body,
    });

    expect(accepted.status).toBe(200);
    expect(wrongPassword.status).toBe(401);
  });
});

describe("webhook verifier helpers", () => {
  test("each provider verifier rejects requests routed to another provider", async () => {
    const body = JSON.stringify({ type: "email.delivered" });
    const headers = await signedResendHeaders("evt_cross", body);
    const resend = resendWebhookVerifier({ secret: resendSecret });

    expect(await resend(webhookInput("resend", headers, body))).toBe(true);
    expect(await resend(webhookInput("postmark", headers, body))).toBe(false);

    const postmark = postmarkBasicAuthVerifier({ username: "hooks", password: "s3cret" });
    const authorization = { authorization: `Basic ${btoa("hooks:s3cret")}` };

    expect(await postmark(webhookInput("postmark", authorization))).toBe(true);
    expect(await postmark(webhookInput("resend", authorization))).toBe(false);
  });

  test("verifyByProvider rejects providers without a verifier", async () => {
    const verify = verifyByProvider({ postmark: postmarkBasicAuthVerifier({ username: "hooks", password: "s3cret" }) });

    expect(await verify(webhookInput("custom", {}))).toBe(false);
  });

  test("postmarkBasicAuthVerifier requires credentials", () => {
    expect(() => postmarkBasicAuthVerifier({ username: "", password: "" })).toThrow("non-empty");
  });
});

describe("ConvexEmail.exposeApi", () => {
  test("rejects an unauthenticated send before queueing", async () => {
    const t = createTest();

    await expect(t.mutation(app.send, message)).rejects.toThrow("Unauthorized");
  });

  test("stamps the authenticated subject as the server-controlled email owner", async () => {
    const t = createTest();
    const asAda = t.withIdentity({ subject: "user_123" });

    const emailId = await asAda.mutation(app.send, message);
    const status = await asAda.query(app.status, { emailId });

    expect(status?._id).toBe(emailId);
    expect(status?.ownerId).toBe("user_123");
  });

  test("queues public batches under one owner", async () => {
    const t = createTest();
    const asAda = t.withIdentity({ subject: "user_123" });

    const ids = await asAda.mutation(app.sendBatch, {
      messages: [message, { ...message, to: "grace@example.com" }],
    });

    expect(ids).toHaveLength(2);

    for (const emailId of ids) {
      expect((await asAda.query(app.status, { emailId }))?.ownerId).toBe("user_123");
    }
  });

  test("hides emails and events from a different authenticated owner", async () => {
    const t = createTest();
    const emailId = await t.withIdentity({ subject: "user_123" }).mutation(app.send, message);
    const asGrace = t.withIdentity({ subject: "user_456" });

    expect(await asGrace.query(app.status, { emailId })).toBeNull();
    expect(await asGrace.query(app.listEvents, { emailId })).toEqual([]);
    expect(await asGrace.mutation(app.cancel, { emailId })).toBe(false);
  });

  test("returns null for an id that is not an email id", async () => {
    const t = createTest();

    expect(await t.withIdentity({ subject: "user_123" }).query(app.status, { emailId: "not-an-id" })).toBeNull();
  });

  test("requires an explicit admin authorizer before exposing configuration", () => {
    expect(() => email.exposeApi({ includeConfigApi: true })).toThrow("authorizeConfig");
  });

  test("exposes the Convex token identifier to custom authorizers", async () => {
    const authorize: ConvexEmailPublicAuthorizer = async (ctx) => {
      const identity = await ctx.auth.getUserIdentity();

      return identity?.tokenIdentifier.startsWith("app|") ? identity.subject : null;
    };

    const auth = { getUserIdentity: async () => ({ subject: "user_123", tokenIdentifier: "app|user_123" }) };

    expect(await authorize({ auth }, "send")).toBe("user_123");
  });
});
