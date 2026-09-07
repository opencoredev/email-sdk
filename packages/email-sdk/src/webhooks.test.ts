import { describe, expect, test } from "bun:test";
import { createHash, createHmac } from "node:crypto";
import { normalizeWebhookEvent, verifyMailgunWebhook, verifyResendWebhook } from "./webhooks.js";
import type { WebhookProvider } from "./webhooks.js";

const now = 1731705121000;
const timestamp = String(now / 1000);
const key = "test-signing-key";
const secret = `whsec_${Buffer.from(key).toString("base64")}`;
function resend(body = '{"type":"email.delivered","data":{"email_id":"é✉️"}}', time = timestamp) {
  return {
    body, secret, now,
    headers: {
      "svix-id": "msg_test", "svix-timestamp": time,
      "svix-signature": `v1,${createHmac("sha256", key).update(`msg_test.${time}.${body}`).digest("base64")}`,
    },
  };
}
function mailgun(event = "delivered", time: string | number = timestamp) {
  const token = "a".repeat(50);
  return {
    secret: key, now,
    body: JSON.stringify({ signature: { timestamp: time, token, signature: createHmac("sha256", key).update(`${time}${token}`).digest("hex") }, "event-data": { event } }),
  };
}

describe("webhook verification", () => {
  test("matches the official Svix fixture", async () => {
    expect(await verifyResendWebhook({
      body: '{"event_type":"ping","data":{"success":true}}',
      secret: "whsec_plJ3nmyCDGBKInavdOK15jsl", now,
      headers: { "svix-id": "msg_loFOjxBNrRLzqYUf", "svix-timestamp": timestamp, "svix-signature": "v1,rAvfW3dJ/X/qxhsaXPOyyCGmRKsaKWcsNccKXlIktD0=" },
    })).toBe(true);
  });
  test("verifies raw Unicode text and case-insensitive Headers/records", async () => {
    const input = resend();
    expect(await verifyResendWebhook(input)).toBe(true);
    expect(await verifyResendWebhook({ ...input, headers: new Headers(input.headers) })).toBe(true);
    expect(await verifyResendWebhook({ ...input, headers: Object.fromEntries(Object.entries(input.headers).map(([k, v]) => [k.toUpperCase(), v])) })).toBe(true);
    expect(await verifyResendWebhook({ ...input, body: input.body + " " })).toBe(false);
    expect(await verifyResendWebhook({ ...input, headers: { ...input.headers, "svix-id": "changed" } })).toBe(false);
    expect(await verifyResendWebhook({ ...input, headers: { ...input.headers, "Svix-Id": "duplicate" } })).toBe(false);
  });
  test("supports rotation and multiple versioned signatures", async () => {
    const input = resend();
    const wrong = Buffer.alloc(32).toString("base64");
    expect(await verifyResendWebhook({ ...input, secret: ["whsec_b2xk", secret], headers: { ...input.headers, "svix-signature": `v2,${wrong} v1,${wrong} ${input.headers["svix-signature"]}` } })).toBe(true);
    expect(await verifyResendWebhook({ ...input, secret: "whsec_d3Jvbmc=" })).toBe(false);
  });
  test("rejects stale/future/non-integer timestamps and invalid tolerance", async () => {
    for (const time of [String(+timestamp - 301), String(+timestamp + 301), `${timestamp}junk`, `${timestamp}.5`, `0${timestamp}`, "-1"]) {
      expect(await verifyResendWebhook(resend("{}", time))).toBe(false);
      expect(await verifyMailgunWebhook(mailgun("delivered", time))).toBe(false);
    }
    expect(await verifyResendWebhook(resend("{}", String(+timestamp - 300)))).toBe(true);
    expect(await verifyMailgunWebhook({ ...mailgun(), toleranceSeconds: -1 })).toBe(false);
    expect(await verifyResendWebhook({ ...resend(), now: NaN })).toBe(false);
    expect(await verifyResendWebhook({ ...resend(), toleranceSeconds: Infinity })).toBe(false);
  });
  test("fails closed on malformed signatures, secrets and non-object JSON", async () => {
    for (const signature of ["", "v1,!!!", "v1,AA==", "v1,", "v1,AAAA,extra", "v1,AAAA "]) {
      const input = resend();
      expect(await verifyResendWebhook({ ...input, headers: { ...input.headers, "svix-signature": signature } })).toBe(false);
    }
    for (const body of ["null", "[]", "1", '"string"', "true", "{"]) {
      expect(await verifyResendWebhook(resend(body))).toBe(false);
      expect(await verifyMailgunWebhook({ ...mailgun(), body })).toBe(false);
    }
    for (const value of ["", "whsec_!!!", []]) {
      expect(await verifyResendWebhook({ ...resend(), secret: value })).toBe(false);
    }
    expect(await verifyResendWebhook({ ...resend(), headers: {} })).toBe(false);
  });
  test("Mailgun authenticates timestamp/token, explicitly not event-data", async () => {
    const input = mailgun();
    expect(await verifyMailgunWebhook(input)).toBe(true);
    expect(await verifyMailgunWebhook(mailgun("delivered", +timestamp))).toBe(true);
    expect(await verifyMailgunWebhook({ ...input, secret: ["old", key] })).toBe(true);
    expect(await verifyMailgunWebhook({ ...input, secret: "wrong" })).toBe(false);
    expect(await verifyMailgunWebhook({ ...input, body: input.body.replace("delivered", "failed") })).toBe(true);
    const payload = JSON.parse(input.body);
    payload.signature.token = "tampered";
    expect(await verifyMailgunWebhook({ ...input, body: JSON.stringify(payload) })).toBe(false);
    payload.signature.token = "";
    expect(await verifyMailgunWebhook({ ...input, body: JSON.stringify(payload) })).toBe(false);
  });
  test("Mailgun parent signature is opt-in and malformed hex fails", async () => {
    const input = mailgun();
    const payload = JSON.parse(input.body);
    payload.signature["parent-signature"] = payload.signature.signature;
    payload.signature.signature = "x".repeat(64);
    const body = JSON.stringify(payload);
    expect(await verifyMailgunWebhook({ ...input, body })).toBe(false);
    expect(await verifyMailgunWebhook({ ...input, body, signatureField: "parent-signature" })).toBe(true);
    expect(await verifyMailgunWebhook({ ...input, body: "{}" })).toBe(false);
  });
});

describe("webhook normalization", () => {
  test("Resend uses delivery identity, not signature headers", async () => {
    const input = resend();
    expect(await normalizeWebhookEvent({ ...input, provider: "resend" })).toMatchObject({ provider: "resend", deliveryId: "msg_test", providerMessageId: "é✉️", type: "delivered", status: "delivered" });
    expect((await normalizeWebhookEvent({ provider: "resend", body: "{}", headers: { "resend-signature": "unstable" } })).deliveryId).toStartWith("body:");
  });
  test("numeric Postmark IDs survive changing retry bodies", async () => {
    for (const extra of ["", " "]) {
      expect(await normalizeWebhookEvent({ provider: "postmark", body: '{"ID":123,"MessageID":"m","RecordType":"Delivery"}' + extra })).toMatchObject({ deliveryId: "123", providerMessageId: "m", type: "delivery", status: "delivered" });
    }
  });
  test("permanent versus temporary provider failures", async () => {
    for (const [Type, status] of [["HardBounce", "bounced"], ["BadEmailAddress", "bounced"], ["ManuallyDeactivated", "bounced"], ["Transient", undefined], ["SoftBounce", undefined], ["DnsError", undefined]]) {
      expect((await normalizeWebhookEvent({ provider: "postmark", body: JSON.stringify({ RecordType: "Bounce", Type }) })).status).toBe(status);
    }
    for (const severity of ["permanent", "temporary", undefined]) {
      const result = await normalizeWebhookEvent({ provider: "mailgun", body: JSON.stringify({ "event-data": { id: "event", event: "failed", severity, message: { headers: { "message-id": "m" } } } }) });
      expect(result).toMatchObject({ deliveryId: "event", providerMessageId: "m", type: "failed" });
      expect(result.status).toBe(severity === "permanent" ? "bounced" : undefined);
    }
  });
  test("unknown events retained; malformed nested shapes cannot invent state", async () => {
    const result = await normalizeWebhookEvent({ provider: "resend", body: '{"type":"email.Future_Event","data":[]}' });
    expect(result.type).toBe("future_event");
    expect(result.status).toBeUndefined();
    expect(result.providerMessageId).toBeUndefined();
    expect((await normalizeWebhookEvent({ provider: "postmark", body: '{"RecordType":"SpamComplaint"}' })).status).toBe("complained");
  });
  test("fallback hashes match legacy algorithm and only deduplicate identical bytes", async () => {
    const body = '{"RecordType":"Open","MessageID":"é"}';
    const input = { provider: "postmark" as const, body };
    const first = await normalizeWebhookEvent(input);
    expect(first.deliveryId).toBe(`body:${createHash("sha256").update("postmark\0" + body).digest("hex")}`);
    expect((await normalizeWebhookEvent(input)).deliveryId).toBe(first.deliveryId);
    expect((await normalizeWebhookEvent({ ...input, body: body + " " })).deliveryId).not.toBe(first.deliveryId);
    expect((await normalizeWebhookEvent({ ...input, provider: "mailgun" })).deliveryId).not.toBe(first.deliveryId);
  });
  test("rejects unsupported providers and non-object JSON", async () => {
    await expect(normalizeWebhookEvent({ provider: "smtp" as WebhookProvider, body: "{}" })).rejects.toThrow("Unsupported webhook");
    for (const body of ["null", "[]", "true", "0", '"text"', "invalid"]) {
      await expect(normalizeWebhookEvent({ provider: "resend", body })).rejects.toThrow();
    }
  });
  test("package exposes helpers only through the webhook subpath", async () => {
    const manifest = await Bun.file(new URL("../package.json", import.meta.url)).json();
    expect(manifest.exports["./webhooks"]).toEqual({ types: "./dist/webhooks.d.ts", default: "./dist/webhooks.js" });
    const root = await import("./index.js");
    expect("verifyResendWebhook" in root).toBe(false);
    expect("normalizeWebhookEvent" in root).toBe(false);
  });
});
