import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, sign } from "node:crypto";

import {
  normalizeWebhookEvent,
  normalizeWebhookEvents,
  verifySendGridWebhook,
} from "./webhooks.js";
import type { JsonObject } from "./webhooks.js";

const now = 1731705121000;

const timestamp = String(now / 1000);

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });

const spki = publicKey.export({ type: "spki", format: "der" }).toString("base64");

const pem = publicKey.export({ type: "spki", format: "pem" }).toString();

const other = generateKeyPairSync("ec", { namedCurve: "P-256" });

const otherSpki = other.publicKey.export({ type: "spki", format: "der" }).toString("base64");

const sendGridBody = JSON.stringify([
  {
    email: "ada@example.com",
    timestamp: 1731705100,
    event: "delivered",
    sg_event_id: "evt_delivered",
    sg_message_id: "14c5d75ce93.filterdrecv-p3mdw1-1.0",
  },
  {
    email: "linus@example.com",
    timestamp: 1731705101,
    event: "bounce",
    type: "bounce",
    sg_event_id: "evt_bounce",
    sg_message_id: "14c5d75ce93.filterdrecv-p3mdw1-1.1",
  },
  { email: "x@example.com", event: "bounce", type: "blocked", sg_event_id: "evt_blocked" },
  { email: "y@example.com", event: "spamreport", sg_event_id: "evt_spam" },
  { email: "z@example.com", event: "dropped", sg_event_id: "evt_dropped" },
]);

function signed(body = sendGridBody, time = timestamp, key = privateKey) {
  return {
    body,
    now,
    publicKey: spki,
    headers: {
      "x-twilio-email-event-webhook-signature": sign(
        "sha256",
        Buffer.concat([Buffer.from(time), Buffer.from(body)]),
        key,
      ).toString("base64"),
      "x-twilio-email-event-webhook-timestamp": time,
    },
  };
}

describe("verifySendGridWebhook", () => {
  test("accepts a valid ECDSA signature over timestamp + raw body", async () => {
    expect(await verifySendGridWebhook(signed())).toBe(true);
  });

  test("accepts PEM keys and a rotation list with one malformed entry", async () => {
    expect(await verifySendGridWebhook({ ...signed(), publicKey: pem })).toBe(true);
    expect(
      await verifySendGridWebhook({ ...signed(), publicKey: ["not-a-key", otherSpki, spki] }),
    ).toBe(true);
  });

  test("rejects a changed body, a wrong key, a stale timestamp, and missing headers", async () => {
    const valid = signed();

    expect(
      await verifySendGridWebhook({ ...valid, body: valid.body.replace("delivered", "bounce") }),
    ).toBe(false);
    expect(await verifySendGridWebhook({ ...valid, publicKey: otherSpki })).toBe(false);
    expect(await verifySendGridWebhook(signed(sendGridBody, String(now / 1000 - 301)))).toBe(false);
    expect(await verifySendGridWebhook({ ...valid, headers: {} })).toBe(false);
    expect(await verifySendGridWebhook({ ...valid, publicKey: [] })).toBe(false);
  });

  test("fails closed on a signature that is not DER and on a non-JSON body", async () => {
    const valid = signed();
    const garbage = { ...valid.headers, "x-twilio-email-event-webhook-signature": "AAAA" };

    expect(await verifySendGridWebhook({ ...valid, headers: garbage })).toBe(false);
    expect(await verifySendGridWebhook(signed("not json"))).toBe(false);
  });

  test("accepts Headers instances", async () => {
    const valid = signed();

    expect(await verifySendGridWebhook({ ...valid, headers: new Headers(valid.headers) })).toBe(
      true,
    );
  });
});

describe("SendGrid event normalization", () => {
  test("normalizes every event in a batch, mapping only final outcomes to a status", async () => {
    const events = await normalizeWebhookEvents({ provider: "sendgrid", body: sendGridBody });

    expect(
      events.map(({ deliveryId, type, status, providerMessageId }) => ({
        deliveryId,
        type,
        status,
        providerMessageId,
      })),
    ).toEqual([
      {
        deliveryId: "evt_delivered",
        type: "delivered",
        status: "delivered",
        providerMessageId: "14c5d75ce93",
      },
      {
        deliveryId: "evt_bounce",
        type: "bounce",
        status: "bounced",
        providerMessageId: "14c5d75ce93",
      },
      {
        deliveryId: "evt_blocked",
        type: "bounce",
        status: undefined,
        providerMessageId: undefined,
      },
      {
        deliveryId: "evt_spam",
        type: "spamreport",
        status: "complained",
        providerMessageId: undefined,
      },
      {
        deliveryId: "evt_dropped",
        type: "dropped",
        status: undefined,
        providerMessageId: undefined,
      },
    ]);
    expect(events[0]?.payload).toMatchObject({ email: "ada@example.com" });
  });

  test("normalizeWebhookEvent takes a one-event body and refuses a batch", async () => {
    const single = JSON.stringify([{ event: "delivered", sg_event_id: "only" }]);

    expect((await normalizeWebhookEvent({ provider: "sendgrid", body: single })).deliveryId).toBe(
      "only",
    );
    await expect(
      normalizeWebhookEvent({ provider: "sendgrid", body: sendGridBody }),
    ).rejects.toThrow("SendGrid posted 5 events in one request; use normalizeWebhookEvents.");
  });

  test("events without sg_event_id get a stable content-derived id", async () => {
    const body = JSON.stringify([{ event: "delivered", email: "a@example.com" }]);
    const [first] = await normalizeWebhookEvents({ provider: "sendgrid", body });
    const [second] = await normalizeWebhookEvents({ provider: "sendgrid", body });

    expect(first?.deliveryId).toMatch(/^body:[0-9a-f]{64}$/);
    expect(first?.deliveryId).toBe(second?.deliveryId);
  });

  test("rejects bodies that are not event objects", async () => {
    for (const body of ["[]", "[1]", '"text"', "nope"]) {
      await expect(normalizeWebhookEvents({ provider: "sendgrid", body })).rejects.toThrow();
    }
  });
});

describe("SES event normalization", () => {
  const sesEvent = (eventType: string, extra: JsonObject = {}): JsonObject => ({
    eventType,
    mail: { messageId: "0100018c-ses-message-id", destination: ["ada@example.com"] },
    ...extra,
  });

  const sns = (message: JsonObject, messageId = "sns-delivery-1") =>
    JSON.stringify({
      Type: "Notification",
      MessageId: messageId,
      TopicArn: "arn:aws:sns:us-east-1:1:ses",
      Message: JSON.stringify(message),
    });

  test("unwraps an SNS notification and maps delivery, complaint, and permanent bounce", async () => {
    const delivered = await normalizeWebhookEvent({
      provider: "ses",
      body: sns(sesEvent("Delivery")),
    });

    expect(delivered).toMatchObject({
      provider: "ses",
      deliveryId: "sns-delivery-1",
      providerMessageId: "0100018c-ses-message-id",
      type: "delivery",
      status: "delivered",
      payload: { eventType: "Delivery" },
    });

    const complaint = await normalizeWebhookEvent({
      provider: "ses",
      body: sns(sesEvent("Complaint"), "sns-2"),
    });

    expect(complaint.status).toBe("complained");

    const permanent = await normalizeWebhookEvent({
      provider: "ses",
      body: sns(sesEvent("Bounce", { bounce: { bounceType: "Permanent" } }), "sns-3"),
    });

    expect(permanent.status).toBe("bounced");
  });

  test("leaves transient bounces and other events without a status", async () => {
    const transient = await normalizeWebhookEvent({
      provider: "ses",
      body: sns(sesEvent("Bounce", { bounce: { bounceType: "Transient" } })),
    });

    const send = await normalizeWebhookEvent({ provider: "ses", body: sns(sesEvent("Send")) });

    expect(transient).toMatchObject({ type: "bounce" });
    expect(transient.status).toBeUndefined();
    expect(send.status).toBeUndefined();
  });

  test("reads identity notifications (notificationType), EventBridge, and bare events", async () => {
    const identity = await normalizeWebhookEvent({
      provider: "ses",
      body: sns({ notificationType: "Delivery", mail: { messageId: "m-identity" } }),
    });

    const eventBridge = await normalizeWebhookEvent({
      provider: "ses",
      body: JSON.stringify({
        id: "eb-1",
        "detail-type": "Email Delivered",
        detail: sesEvent("Delivery"),
      }),
    });

    const bare = await normalizeWebhookEvent({
      provider: "ses",
      body: JSON.stringify(sesEvent("Complaint")),
    });

    expect(identity).toMatchObject({ status: "delivered", providerMessageId: "m-identity" });
    expect(eventBridge).toMatchObject({ deliveryId: "eb-1", status: "delivered" });
    expect(bare.status).toBe("complained");
    expect(bare.deliveryId).toMatch(/^body:/);
  });

  test("refuses SNS subscription confirmations and malformed notifications", async () => {
    await expect(
      normalizeWebhookEvent({
        provider: "ses",
        body: JSON.stringify({ Type: "SubscriptionConfirmation", SubscribeURL: "https://x" }),
      }),
    ).rejects.toThrow("SubscriptionConfirmation");

    await expect(
      normalizeWebhookEvent({
        provider: "ses",
        body: JSON.stringify({ Type: "Notification", Message: "not json" }),
      }),
    ).rejects.toThrow("SNS notification Message must be SES event JSON.");
  });

  test("normalizeWebhookEvents returns one event for single-event providers", async () => {
    expect(
      await normalizeWebhookEvents({ provider: "ses", body: sns(sesEvent("Delivery")) }),
    ).toHaveLength(1);
  });
});
