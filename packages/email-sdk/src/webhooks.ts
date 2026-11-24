import {
  type JsonObject,
  type JsonValue,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  isStringMember,
  parseJson,
  parseJsonStrict,
} from "./internal/decode.js";
import { verifySendGridSignature } from "./internal/sendgrid-signature.js";

export type { JsonObject, JsonValue } from "./internal/decode.js";

export type WebhookHeaders = Headers | Readonly<Record<string, string | undefined>>;

export type WebhookProvider = "resend" | "postmark" | "mailgun" | "sendgrid" | "ses";

const WEBHOOK_PROVIDERS: ReadonlySet<string> = new Set<WebhookProvider>(["resend", "postmark", "mailgun", "sendgrid", "ses"]);

export type WebhookDeliveryStatus = "delivered" | "bounced" | "complained";

export interface WebhookVerificationOptions {
  body: string;
  secret: string | readonly string[];
  toleranceSeconds?: number;
  /** Current time in epoch milliseconds. */
  now?: number;
}

export interface ResendWebhookVerificationOptions extends WebhookVerificationOptions {
  headers: WebhookHeaders;
}

export interface MailgunWebhookVerificationOptions extends WebhookVerificationOptions {
  signatureField?: "signature" | "parent-signature";
}

export interface SendGridWebhookVerificationOptions {
  /** The raw request body, exactly as received. */
  body: string;
  headers: WebhookHeaders;
  /** The Event Webhook verification key (base64 SPKI or PEM). Pass several to rotate. */
  publicKey: string | readonly string[];
  toleranceSeconds?: number;
  /** Current time in epoch milliseconds. */
  now?: number;
}

export interface NormalizeWebhookOptions {
  provider: WebhookProvider;
  body: string;
  headers?: WebhookHeaders;
}

export interface NormalizedWebhookEvent {
  provider: WebhookProvider;
  deliveryId: string;
  providerMessageId?: string;
  type?: string;
  status?: WebhookDeliveryStatus;
  payload: JsonObject;
}

const encoder = new TextEncoder();

function object(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function parseBody(body: string): JsonObject {
  if (!isStringMember(body)) throw new Error("Webhook body must be raw JSON text.");
  const payload = object(parseJsonStrict(body));

  if (!payload) throw new Error("Webhook payload must be a JSON object.");

  return payload;
}

function text(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.length > 0 ? value : undefined;
}

function header(headers: WebhookHeaders | undefined, name: string): string | undefined {
  if (!headers) return undefined;

  if (headers instanceof Headers) return text(headers.get(name));
  const matches = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);

  if (matches.length > 1) throw new Error("Duplicate webhook header.");

  return text(matches[0]?.[1]);
}

function timestampValid(
  value: JsonValue | undefined,
  options: Pick<WebhookVerificationOptions, "toleranceSeconds" | "now">,
): value is string | number {
  if (!isJsonString(value) && !isJsonNumber(value)) return false;

  if (!/^(0|[1-9]\d*)$/.test(String(value))) return false;
  const timestamp = Number(value);
  const now = options.now ?? Date.now();
  const tolerance = options.toleranceSeconds ?? 300;

  return Number.isSafeInteger(timestamp) && Number.isFinite(now) &&
    Number.isFinite(tolerance) && tolerance >= 0 &&
    Math.abs(now / 1000 - timestamp) <= tolerance;
}

function secrets(value: string | readonly string[]): readonly string[] {
  const keys = isStringMember(value) ? [value] : value;

  if (!Array.isArray(keys) || !keys.length || keys.some(key => !isStringMember(key) || !key.length)) {
    throw new Error("Webhook signing secret is required.");
  }

  return keys;
}

function base64(value: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 === 1) {
    throw new Error("Malformed base64.");
  }

  const decoded = atob(value);

  if (btoa(decoded).replace(/=+$/, "") !== value.replace(/=+$/, "")) {
    throw new Error("Malformed base64.");
  }

  return Uint8Array.from(decoded, char => char.charCodeAt(0));
}

async function verify(key: Uint8Array<ArrayBuffer>, signature: Uint8Array<ArrayBuffer>, content: string) {
  const cryptoKey = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);

  return crypto.subtle.verify("HMAC", cryptoKey, signature, encoder.encode(content));
}

/** Verify the original UTF-8 JSON body, Svix headers, and timestamp. Invalid input returns false. */
export async function verifyResendWebhook(options: ResendWebhookVerificationOptions): Promise<boolean> {
  try {
    const id = header(options.headers, "svix-id");
    const timestamp = header(options.headers, "svix-timestamp");
    const signatures = header(options.headers, "svix-signature");

    if (!id || !timestamp || !signatures || !timestampValid(timestamp, options)) return false;
    parseBody(options.body);
    const candidates: Uint8Array<ArrayBuffer>[] = [];

    for (const entry of signatures.split(" ")) {
      const match = /^(v\d+),([^,]+)$/.exec(entry);

      if (!match) return false;
      const signature = base64(match[2]!);

      if (match[1] === "v1") {
        if (signature.length !== 32) return false;
        candidates.push(signature);
      }
    }

    const keys = secrets(options.secret).map(secret => base64(secret.replace(/^whsec_/, "")));

    for (const key of keys) {
      for (const signature of candidates) {
        if (await verify(key, signature, `${id}.${timestamp}.${options.body}`)) return true;
      }
    }

    return false;
  } catch {
    return false;
  }
}

/** Mailgun signs timestamp + token, NOT the body. Use TLS and persistent replay protection. */
export async function verifyMailgunWebhook(options: MailgunWebhookVerificationOptions): Promise<boolean> {
  try {
    const payload = parseBody(options.body);
    const signed = object(payload.signature);

    if (!signed || !timestampValid(signed.timestamp, options)) return false;
    const token = text(signed.token);
    const field = options.signatureField ?? "signature";

    if (field !== "signature" && field !== "parent-signature") return false;
    const signature = text(signed[field]);

    if (!token || !signature || !/^[a-fA-F0-9]{64}$/.test(signature)) return false;
    const bytes = Uint8Array.from(signature.match(/../g)!, pair => Number.parseInt(pair, 16));

    for (const secret of secrets(options.secret)) {
      if (await verify(encoder.encode(secret), bytes, `${signed.timestamp}${token}`)) return true;
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Verify a SendGrid Event Webhook request: ECDSA P-256 / SHA-256 over
 * `X-Twilio-Email-Event-Webhook-Timestamp` followed by the raw body, plus timestamp tolerance.
 * Invalid input, a malformed key, or a non-JSON body returns false.
 */
export async function verifySendGridWebhook(options: SendGridWebhookVerificationOptions): Promise<boolean> {
  try {
    const signature = header(options.headers, "x-twilio-email-event-webhook-signature");
    const timestamp = header(options.headers, "x-twilio-email-event-webhook-timestamp");

    if (!signature || !timestamp || !timestampValid(timestamp, options)) return false;
    sendGridEvents(options.body);

    const result = await verifySendGridSignature({
      publicKeys: secrets(options.publicKey),
      signature,
      timestamp,
      body: encoder.encode(options.body),
    });

    return result === "verified";
  } catch {
    return false;
  }
}

async function bodyDigest(provider: WebhookProvider, content: string) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${provider}\0${content}`));

  return `body:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
}

function assertWebhookProvider(provider: WebhookProvider) {
  if (!WEBHOOK_PROVIDERS.has(provider)) {
    throw new Error(`Unsupported webhook normalization provider: ${provider}`);
  }
}

/** SendGrid posts a JSON array of events; a single event object is accepted too. */
function sendGridEvents(body: string): JsonObject[] {
  if (!isStringMember(body)) throw new Error("Webhook body must be raw JSON text.");
  const parsed = parseJsonStrict(body);
  const list = Array.isArray(parsed) ? parsed : [parsed];
  const events = list.filter(isJsonObject);

  if (events.length === 0 || events.length !== list.length) {
    throw new Error("SendGrid webhook body must be a JSON array of event objects.");
  }

  return events;
}

async function normalizeSendGridEvent(event: JsonObject): Promise<NormalizedWebhookEvent> {
  const type = text(event.event)?.toLowerCase();
  let status: WebhookDeliveryStatus | undefined;

  if (type === "delivered") status = "delivered";

  if (type === "spamreport") status = "complained";

  // SendGrid's "bounce" event covers hard bounces (type "bounce") and temporary blocks
  // (type "blocked"); only the hard bounce is final. "dropped" means SendGrid never sent it.
  if (type === "bounce") {
    const bounceType = text(event.type)?.toLowerCase();

    if (bounceType === undefined || bounceType === "bounce") status = "bounced";
  }

  const normalized: NormalizedWebhookEvent = {
    provider: "sendgrid",
    deliveryId: text(event.sg_event_id) ?? (await bodyDigest("sendgrid", JSON.stringify(event))),
    payload: event,
  };

  // sg_message_id is the send's X-Message-ID plus a ".filter..." suffix; the prefix matches the
  // id the sendgrid adapter returns.
  const providerMessageId = text(event.sg_message_id)?.split(".")[0];

  if (providerMessageId) normalized.providerMessageId = providerMessageId;

  if (type) normalized.type = type;

  if (status) normalized.status = status;

  return normalized;
}

/**
 * SES delivers events through SNS (an envelope whose `Message` is the event JSON), EventBridge
 * (`detail`), or as the bare event. Event publishing uses `eventType`; identity notifications
 * use `notificationType`. The returned payload is the SES event, not the transport envelope.
 */
async function normalizeSesEvent(body: string): Promise<NormalizedWebhookEvent> {
  const envelope = parseBody(body);
  const snsType = text(envelope.Type);

  if (snsType === "SubscriptionConfirmation" || snsType === "UnsubscribeConfirmation") {
    throw new Error(`SNS ${snsType} is not an SES event. Confirm the subscription with its SubscribeURL first.`);
  }

  const snsMessage = snsType === "Notification" && isJsonString(envelope.Message) ? object(parseJson(envelope.Message)) : undefined;

  if (snsType === "Notification" && !snsMessage) throw new Error("SNS notification Message must be SES event JSON.");

  const detail = text(envelope["detail-type"]) ? object(envelope.detail) : undefined;
  const event = snsMessage ?? detail ?? envelope;
  const rawType = text(event.eventType) ?? text(event.notificationType);
  const type = rawType?.toLowerCase();
  let status: WebhookDeliveryStatus | undefined;

  if (type === "delivery") status = "delivered";

  if (type === "complaint") status = "complained";

  // Transient and Undetermined bounces may still deliver later; only Permanent is final.
  if (type === "bounce" && text(object(event.bounce)?.bounceType)?.toLowerCase() === "permanent") status = "bounced";

  const transportId = snsMessage ? text(envelope.MessageId) : detail ? text(envelope.id) : undefined;

  const normalized: NormalizedWebhookEvent = {
    provider: "ses",
    deliveryId: transportId ?? (await bodyDigest("ses", body)),
    payload: event,
  };

  const providerMessageId = text(object(event.mail)?.messageId);

  if (providerMessageId) normalized.providerMessageId = providerMessageId;

  if (type) normalized.type = type;

  if (status) normalized.status = status;

  return normalized;
}

/**
 * Normalize every event in an authenticated webhook body. SendGrid batches several events per
 * request; the other providers send one. This function does not verify authenticity.
 */
export async function normalizeWebhookEvents(options: NormalizeWebhookOptions): Promise<NormalizedWebhookEvent[]> {
  assertWebhookProvider(options.provider);

  if (options.provider === "sendgrid") return Promise.all(sendGridEvents(options.body).map(normalizeSendGridEvent));

  return [await normalizeWebhookEvent(options)];
}

/**
 * Normalize authenticated provider JSON. This function does not verify authenticity. A SendGrid
 * body must hold exactly one event; use `normalizeWebhookEvents` for SendGrid batches.
 */
export async function normalizeWebhookEvent(options: NormalizeWebhookOptions): Promise<NormalizedWebhookEvent> {
  const { provider, body, headers } = options;
  assertWebhookProvider(provider);

  if (provider === "sendgrid") {
    const events = sendGridEvents(body);
    const [only] = events;

    if (!only || events.length !== 1) {
      throw new Error(`SendGrid posted ${events.length} events in one request; use normalizeWebhookEvents.`);
    }

    return normalizeSendGridEvent(only);
  }

  if (provider === "ses") return normalizeSesEvent(body);

  const payload = parseBody(body);
  const data = object(payload.data);
  const eventData = object(payload["event-data"]);
  const messageHeaders = object(object(eventData?.message)?.headers);

  const rawType = provider === "resend" ? text(payload.type) :
    text(payload.event) ?? text(payload.type) ?? text(payload.RecordType) ?? text(eventData?.event);

  const type = rawType?.toLowerCase().replace(/^email\./, "");
  let status: WebhookDeliveryStatus | undefined;

  if (type === "delivered" || type === "delivery") status = "delivered";

  if (["complained", "complaint", "spamcomplaint", "spam_complaint", "spamreport"].includes(type ?? "")) status = "complained";

  if (type === "bounced" || type === "permanent_fail") status = "bounced";

  if (type === "failed" && text(eventData?.severity)?.toLowerCase() === "permanent") status = "bounced";

  if (type === "bounce") {
    const bounceType = text(payload.Type)?.toLowerCase();

    if (bounceType === undefined || ["hardbounce", "bademailaddress", "manuallydeactivated"].includes(bounceType)) status = "bounced";
  }

  const numericId = isJsonNumber(payload.ID) && Number.isFinite(payload.ID) ? String(payload.ID) : undefined;

  let deliveryId = provider === "resend"
    ? text(payload.id) ?? header(headers, "svix-id")
    : text(payload.id) ?? text(payload.ID) ?? numericId ?? text(payload.eventId) ?? text(payload.webhookId) ?? text(payload.deliveryId) ?? text(eventData?.id);

  deliveryId ??= await bodyDigest(provider, body);

  const providerMessageId = provider === "resend"
    ? text(data?.email_id) ?? text(data?.id)
    : text(payload.messageId) ?? text(payload.message_id) ?? text(payload.MessageID) ?? text(messageHeaders?.["message-id"]);

  const event: NormalizedWebhookEvent = { provider, deliveryId, payload };

  if (providerMessageId) event.providerMessageId = providerMessageId;

  if (type) event.type = type;

  if (status) event.status = status;

  return event;
}
