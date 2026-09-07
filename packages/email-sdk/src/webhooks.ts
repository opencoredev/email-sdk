export type WebhookHeaders = Headers | Readonly<Record<string, string | undefined>>;
export type WebhookProvider = "resend" | "postmark" | "mailgun";
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
  payload: Record<string, unknown>;
}

const encoder = new TextEncoder();

function object(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}
function parseBody(body: string): Record<string, unknown> {
  if (typeof body !== "string") throw new Error("Webhook body must be raw JSON text.");
  const payload = object(JSON.parse(body));
  if (!payload) throw new Error("Webhook payload must be a JSON object.");
  return payload;
}
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
function header(headers: WebhookHeaders | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  if (headers instanceof Headers) return text(headers.get(name));
  const matches = Object.entries(headers).filter(([key]) => key.toLowerCase() === name);
  if (matches.length > 1) throw new Error("Duplicate webhook header.");
  return text(matches[0]?.[1]);
}
function timestampValid(value: unknown, options: WebhookVerificationOptions): value is string | number {
  if (typeof value !== "string" && typeof value !== "number") return false;
  if (!/^(0|[1-9]\d*)$/.test(String(value))) return false;
  const timestamp = Number(value);
  const now = options.now ?? Date.now();
  const tolerance = options.toleranceSeconds ?? 300;
  return Number.isSafeInteger(timestamp) && Number.isFinite(now) &&
    Number.isFinite(tolerance) && tolerance >= 0 &&
    Math.abs(now / 1000 - timestamp) <= tolerance;
}
function secrets(value: string | readonly string[]): readonly string[] {
  const keys = typeof value === "string" ? [value] : value;
  if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== "string" || !key.length)) {
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

/** Normalize authenticated provider JSON. This function does not verify authenticity. */
export async function normalizeWebhookEvent(options: NormalizeWebhookOptions): Promise<NormalizedWebhookEvent> {
  const { provider, body, headers } = options;
  if (provider !== "resend" && provider !== "postmark" && provider !== "mailgun") {
    throw new Error(`Unsupported webhook normalization provider: ${provider}`);
  }
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
  const numericId = typeof payload.ID === "number" && Number.isFinite(payload.ID) ? String(payload.ID) : undefined;
  let deliveryId = provider === "resend"
    ? text(payload.id) ?? header(headers, "svix-id")
    : text(payload.id) ?? text(payload.ID) ?? numericId ?? text(payload.eventId) ?? text(payload.webhookId) ?? text(payload.deliveryId) ?? text(eventData?.id);
  if (!deliveryId) {
    const digest = await crypto.subtle.digest("SHA-256", encoder.encode(`${provider}\0${body}`));
    deliveryId = `body:${Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("")}`;
  }
  const providerMessageId = provider === "resend"
    ? text(data?.email_id) ?? text(data?.id)
    : text(payload.messageId) ?? text(payload.message_id) ?? text(payload.MessageID) ?? text(messageHeaders?.["message-id"]);
  return { provider, deliveryId, ...(providerMessageId ? { providerMessageId } : {}), ...(type ? { type } : {}), ...(status ? { status } : {}), payload };
}
