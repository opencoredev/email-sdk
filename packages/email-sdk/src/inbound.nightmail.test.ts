import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { handleInbound, parseInbound, parseNightmailInbound, verifyNightmailInbound } from "./inbound.js";

const body = readFileSync(new URL("./__fixtures__/inbound/nightmail-email-received.json", import.meta.url), "utf8");

const now = 1_760_000_000_000;

const key = Buffer.from("nightmail-signing-key-32-bytes!!");

const secret = `whsec_${key.toString("base64")}`;

function signed(payload: string, time = String(now / 1000)) {
  return {
    "webhook-id": "evt_1",
    "webhook-timestamp": time,
    "webhook-signature": `v1,${createHmac("sha256", key).update(`evt_1.${time}.${payload}`).digest("base64")}`,
  };
}

function withoutRaw() {
  const root = JSON.parse(body);
  root.email.parsedData.raw = null;

  return JSON.stringify(root);
}

describe("Nightmail inbound", () => {
  test("verifies Standard Webhooks signatures on webhook-* headers", async () => {
    expect(await verifyNightmailInbound({ body, headers: signed(body) }, { secret, now })).toEqual({ ok: true });
    expect(await verifyNightmailInbound({ body, headers: signed(body) }, { secret: ["whsec_b3RoZXI=", secret], now })).toEqual({ ok: true });
    expect(await verifyNightmailInbound({ body: `${body} `, headers: signed(body) }, { secret, now })).toEqual({ ok: false, reason: "signature_invalid" });
    expect(await verifyNightmailInbound({ body, headers: signed(body, String(now / 1000 - 600)) }, { secret, now })).toEqual({ ok: false, reason: "timestamp_expired" });
    expect(await verifyNightmailInbound({ body, headers: {} }, { secret, now })).toEqual({ ok: false, reason: "signature_missing" });

    const svix = Object.fromEntries(Object.entries(signed(body)).map(([name, value]) => [name.replace("webhook-", "svix-"), value]));
    expect(await verifyNightmailInbound({ body, headers: svix }, { secret, now })).toEqual({ ok: false, reason: "signature_missing" });
  });

  test("parses the inlined MIME of an inbound-format email.received", async () => {
    const email = parseNightmailInbound({ body });

    expect(email).toMatchObject({
      provider: "nightmail",
      id: "msg_01JNIGHTMAIL",
      messageId: "thread-1@example.net",
      from: { address: "ada@example.net", name: "Ada Lovelace" },
      to: [{ address: "support@reply.acme.test" }],
      cc: [{ address: "grace@example.net", name: "Grace" }],
      subject: "Invoice question",
      text: "Where is invoice 41?",
      inReplyTo: "order-41@acme.test",
      references: ["order-40@acme.test", "order-41@acme.test"],
      envelope: { to: ["support@reply.acme.test", "audit@reply.acme.test"] },
      security: { spam: "pass" },
      raw: { kind: "json" },
    });
    expect(email.attachments).toHaveLength(1);
    expect(new TextDecoder().decode(await email.attachments[0]!.read())).toBe("Invoice 41");
  });

  test("falls back to the parsed fields when the raw MIME is not inlined", async () => {
    const email = parseNightmailInbound({ body: withoutRaw() });

    expect(email).toMatchObject({
      provider: "nightmail",
      id: "msg_01JNIGHTMAIL",
      messageId: "thread-1@example.net",
      from: { address: "ada@example.net", name: "Ada Lovelace" },
      to: [{ address: "support@reply.acme.test" }],
      cc: [{ address: "grace@example.net", name: "Grace" }],
      bcc: [],
      text: "Where is invoice 41?",
      html: "<p>Where is invoice 41?</p>",
      inReplyTo: "order-41@acme.test",
      references: ["order-40@acme.test", "order-41@acme.test"],
      envelope: { to: ["support@reply.acme.test", "audit@reply.acme.test"] },
      security: { spam: "pass" },
    });
    expect(email.date?.toISOString()).toBe("2026-11-24T12:00:00.000Z");
    expect(email.headers.get("X-Priority")).toBe("3");
    expect(email.attachments[0]).toMatchObject({
      filename: "invoice.txt",
      contentType: "text/plain",
      size: 10,
      disposition: "attachment",
      url: "https://nightmail.dev/v1/inbound/messages/msg_01JNIGHTMAIL/parts/att_1",
    });
    await expect(email.attachments[0]!.read()).rejects.toMatchObject({ reason: "payload_invalid", provider: "nightmail" });
  });

  test("reports junk mail through security.spam", () => {
    const root = JSON.parse(body);
    root.email.spam = { isJunk: true, reason: "ses_spam" };

    expect(parseNightmailInbound({ body: JSON.stringify(root) }).security.spam).toBe("fail");
  });

  test("rejects the thin nightmail-format event and malformed payloads", () => {
    const thin = JSON.stringify({ id: "evt_1", type: "message.received", messageId: "msg_1", threadId: "thr_1", data: {} });

    expect(() => parseNightmailInbound({ body: thin })).toThrow(/format "inbound"/);
    expect(() => parseNightmailInbound({ body: JSON.stringify({ event: "email.received" }) })).toThrow(/parsedData/);
    expect(() => parseNightmailInbound({ body: "not json" })).toThrow();
  });

  test("parseInbound and handleInbound route nightmail", async () => {
    expect((await parseInbound("nightmail", { body }))[0]?.id).toBe("msg_01JNIGHTMAIL");

    const request = () => new Request("https://app.test/inbound", { method: "POST", body, headers: signed(body) });
    const result = await handleInbound(request(), { provider: "nightmail", secret, now });

    expect(result).toMatchObject({ type: "emails", emails: [{ provider: "nightmail", id: "msg_01JNIGHTMAIL" }] });
    await expect(handleInbound(request(), { provider: "nightmail", secret: "whsec_b3RoZXI=", now })).rejects.toMatchObject({ reason: "signature_invalid" });
  });
});
