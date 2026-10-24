import { createSigningKeyCache, signAwsRequest } from "../internal/aws-sigv4.js";
import type { JsonObject, JsonValue } from "../internal/decode.js";
import { emailFromMime } from "./normalize.js";
import {
  type InboundFetchOptions,
  decodeBase64,
  decodeBase64Strict,
  jsonList,
  jsonObject,
  jsonText,
  parseJsonBody,
  parseJsonObjectBody,
  payloadError,
  providerFetch,
  rejected,
  utf8Bytes,
  verdict,
  verified,
} from "./shared.js";
import {
  type InboundClockOptions,
  type InboundEmail,
  InboundError,
  type InboundRequestPayload,
  type InboundSecurity,
  type InboundVerification,
} from "./types.js";

const provider = "ses";

/** An SNS HTTP(S) delivery: a notification or a subscription lifecycle message. */
export interface SnsMessage {
  Type: "Notification" | "SubscriptionConfirmation" | "UnsubscribeConfirmation";
  MessageId: string;
  TopicArn: string;
  Message: string;
  Timestamp: string;
  SignatureVersion: "1" | "2";
  Signature: string;
  SigningCertURL: string;
  Subject?: string;
  Token?: string;
  SubscribeURL?: string;
  UnsubscribeURL?: string;
}

/** SNS retries can arrive minutes after signing, so the default window is wider than webhooks'. */
const SNS_TOLERANCE_SECONDS = 3600;

export interface SnsVerificationOptions extends InboundFetchOptions, InboundClockOptions {
  /** Only accept messages from these topic ARNs. Required by `parseSesInbound` and `handleInbound`. */
  topicArn?: string | readonly string[];
  /**
   * Cache for signing keys, keyed by hash and certificate URL. Defaults to a per-process cache.
   * Only keys that verified a signature are stored; the cache is trimmed to 16 entries and entries expire after a day.
   */
  certificateCache?: Map<string, SnsCertificateCacheEntry>;
}

export interface SnsCertificateCacheEntry {
  key: CryptoKey;
  expiresAt: number;
}

export interface SesS3Location {
  bucket: string;
  key: string;
}

export interface SesInboundS3Options extends InboundFetchOptions {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  sessionToken?: string;
  /** Override the S3 endpoint, for example a VPC endpoint or a local fixture. */
  endpoint?: string;
}

const defaultCertificateCache = new Map<string, SnsCertificateCacheEntry>();

// Holds only the derived key for the most recent (secret, UTC day, region) S3 scope.
const s3SigningKeys = createSigningKeyCache();

const CERTIFICATE_CACHE_LIMIT = 16;

const CERTIFICATE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/** Parse an SNS HTTP delivery body. */
export function parseSnsMessage(body: string | Uint8Array): SnsMessage {
  const value = parseJsonObjectBody(provider, body);
  const type = jsonText(value.Type);
  const version = jsonText(value.SignatureVersion);
  const required = ["MessageId", "TopicArn", "Message", "Timestamp", "Signature", "SigningCertURL"] as const;

  if (type !== "Notification" && type !== "SubscriptionConfirmation" && type !== "UnsubscribeConfirmation") {
    throw payloadError(provider, `SNS message Type ${type ?? "(missing)"} is not supported.`);
  }

  if (version !== "1" && version !== "2") throw payloadError(provider, "SNS SignatureVersion must be 1 or 2.");

  const message: SnsMessage = {
    Type: type,
    SignatureVersion: version,
    MessageId: "",
    TopicArn: "",
    Message: "",
    Timestamp: "",
    Signature: "",
    SigningCertURL: "",
  };

  for (const key of required) {
    const field = jsonText(value[key]);

    if (field === undefined) throw payloadError(provider, `SNS message is missing ${key}.`);

    message[key] = field;
  }

  for (const key of ["Subject", "Token", "SubscribeURL", "UnsubscribeURL"] as const) {
    const field = jsonText(value[key]);

    if (field !== undefined) message[key] = field;
  }

  return message;
}

/** SNS signing certificates are only served from `https://sns.<region>.amazonaws.com[.cn]/*.pem`. */
export function isTrustedSnsUrl(value: string): boolean {
  try {
    const url = new URL(value);

    return url.protocol === "https:" && url.port === "" && url.username === "" &&
      /^sns\.[a-z0-9-]+\.amazonaws\.com(?:\.cn)?$/.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * Parse a signing certificate URL, accepting only the exact shape SNS uses:
 * `https://sns.<region>.amazonaws.com[.cn]/SimpleNotificationService-<hex>.pem` with no port, userinfo, query, or fragment.
 * Rejecting variants keeps attacker-chosen spellings of one URL from becoming separate cache entries.
 */
function signingCertUrl(value: string): URL | undefined {
  if (!isTrustedSnsUrl(value)) return undefined;

  const url = new URL(value);

  // Requiring the serialized form to round-trip rejects `:443`, `#frag`, `?q`, mixed-case hosts, and dot segments.
  if (url.href !== value || url.search !== "" || url.hash !== "") return undefined;

  return /^\/SimpleNotificationService-[0-9a-f]+\.pem$/.test(url.pathname) ? url : undefined;
}

function canonicalString(message: SnsMessage): string {
  const keys = message.Type === "Notification"
    ? ["Message", "MessageId", "Subject", "Timestamp", "TopicArn", "Type"] as const
    : ["Message", "MessageId", "SubscribeURL", "Timestamp", "Token", "TopicArn", "Type"] as const;

  return keys.flatMap(key => {
    const value = message[key];

    return value === undefined ? [] : [`${key}\n${value}\n`];
  }).join("");
}

interface DerElement {
  tag: number;
  start: number;
  contentStart: number;
  end: number;
}

function derElement(bytes: Uint8Array, start: number): DerElement {
  const tag = bytes[start];
  let length = bytes[start + 1];
  let contentStart = start + 2;

  if (tag === undefined || length === undefined) throw new Error("Truncated DER.");

  if (length & 0x80) {
    const count = length & 0x7f;

    if (count === 0 || count > 4) throw new Error("Unsupported DER length.");

    length = 0;

    for (let index = 0; index < count; index += 1) length = length * 256 + (bytes[contentStart + index] ?? 0);

    contentStart += count;
  }

  const end = contentStart + length;

  if (end > bytes.length) throw new Error("Truncated DER.");

  return { tag, start, contentStart, end };
}

/** Extract the SubjectPublicKeyInfo from an X.509 certificate so WebCrypto can import it. */
export function certificatePublicKey(pem: string): Uint8Array<ArrayBuffer> {
  const base64 = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem)?.[1];

  if (!base64) throw new Error("No PEM certificate found.");

  const der = decodeBase64Strict(base64.replace(/\s/g, ""));
  const certificate = derElement(der, 0);
  const tbs = derElement(der, certificate.contentStart);
  let cursor = tbs.contentStart;
  let element = derElement(der, cursor);

  // Optional [0] EXPLICIT version.
  if (element.tag === 0xa0) {
    cursor = element.end;
    element = derElement(der, cursor);
  }

  // serialNumber, signature, issuer, validity, subject, then subjectPublicKeyInfo.
  for (let skip = 0; skip < 5; skip += 1) {
    cursor = element.end;
    element = derElement(der, cursor);
  }

  if (element.tag !== 0x30) throw new Error("Certificate has no SubjectPublicKeyInfo.");

  return der.slice(element.start, element.end);
}

async function fetchSigningKey(url: URL, hash: string, options: SnsVerificationOptions): Promise<CryptoKey> {
  // A redirect would leave the checked SNS host, so it is an error rather than followed.
  const response = await providerFetch(provider, url.href, { fetch: options.fetch, signal: options.signal, redirect: "error" });

  return crypto.subtle.importKey(
    "spki",
    certificatePublicKey(await response.text()),
    { name: "RSASSA-PKCS1-v1_5", hash },
    false,
    ["verify"],
  );
}

function cachedSigningKey(
  cache: Map<string, SnsCertificateCacheEntry>,
  cacheKey: string,
  now: number,
): CryptoKey | undefined {
  const entry = cache.get(cacheKey);

  if (!entry) return undefined;

  // Re-insert so Map order tracks recency for eviction.
  cache.delete(cacheKey);

  if (entry.expiresAt <= now) return undefined;

  cache.set(cacheKey, entry);

  return entry.key;
}

function cacheSigningKey(cache: Map<string, SnsCertificateCacheEntry>, cacheKey: string, key: CryptoKey, now: number): void {
  cache.delete(cacheKey);
  cache.set(cacheKey, { key, expiresAt: now + CERTIFICATE_CACHE_TTL_MS });

  for (const oldest of cache.keys()) {
    if (cache.size <= CERTIFICATE_CACHE_LIMIT) break;

    cache.delete(oldest);
  }
}

/**
 * Verify an SNS message signature (SignatureVersion 1 = SHA1withRSA, 2 = SHA256withRSA).
 * The certificate URL must be an `sns.<region>.amazonaws.com` HTTPS URL.
 */
export async function verifySnsMessage(
  message: SnsMessage,
  options: SnsVerificationOptions = {},
): Promise<InboundVerification> {
  const certUrl = signingCertUrl(message.SigningCertURL);

  if (!certUrl) return rejected("signature_invalid");

  if (options.topicArn !== undefined) {
    const allowed = Array.isArray(options.topicArn) ? options.topicArn : [options.topicArn];

    if (!allowed.includes(message.TopicArn)) return rejected("signature_invalid");
  }

  const signedAt = Date.parse(message.Timestamp);
  const now = options.now ?? Date.now();
  const tolerance = options.toleranceSeconds ?? SNS_TOLERANCE_SECONDS;

  if (!/^\d{4}-\d{2}-\d{2}T/.test(message.Timestamp) || !Number.isFinite(signedAt) ||
    !(tolerance >= 0) || Math.abs(now - signedAt) > tolerance * 1000) {
    return rejected("timestamp_expired");
  }

  let signature: Uint8Array<ArrayBuffer>;

  try {
    signature = decodeBase64Strict(message.Signature);
  } catch {
    return rejected("signature_invalid");
  }

  const cache = options.certificateCache ?? defaultCertificateCache;
  const hash = message.SignatureVersion === "1" ? "SHA-1" : "SHA-256";
  const cacheKey = `${hash} ${certUrl.href}`;
  const cached = cachedSigningKey(cache, cacheKey, now);
  let key: CryptoKey;

  try {
    key = cached ?? await fetchSigningKey(certUrl, hash, options);
  } catch (error) {
    if (error instanceof InboundError) throw error;

    return rejected("signature_invalid");
  }

  const valid = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, signature, utf8Bytes(canonicalString(message)));

  if (!valid) return rejected("signature_invalid");

  if (!cached) cacheSigningKey(cache, cacheKey, key, now);

  return verified;
}

/** Confirm an SNS subscription by visiting its trusted SubscribeURL. */
export async function confirmSnsSubscription(message: SnsMessage, options: InboundFetchOptions = {}): Promise<void> {
  if (message.Type !== "SubscriptionConfirmation" || !message.SubscribeURL || !isTrustedSnsUrl(message.SubscribeURL)) {
    throw payloadError(provider, "SNS message is not a confirmable subscription from an amazonaws.com host.");
  }

  await providerFetch(provider, message.SubscribeURL, { fetch: options.fetch, signal: options.signal, redirect: "error" });
}

function sesVerdict(receipt: JsonObject | undefined, field: string) {
  return verdict(jsonText(jsonObject(receipt?.[field])?.status));
}

/** The SES "Received" notification inside an SNS message, with S3 location when stored there. */
export interface SesReceivedNotification {
  notification: JsonObject;
  content?: Uint8Array;
  s3?: SesS3Location;
}

/** Read an SES receipt notification from `SnsMessage.Message`. */
export function parseSesNotification(message: string): SesReceivedNotification {
  const notification = jsonObject(parseJsonBody(provider, message));

  if (!notification || jsonText(notification.notificationType) !== "Received") {
    throw payloadError(provider, "SES notification is not a Received notification.");
  }

  const action = jsonObject(jsonObject(notification.receipt)?.action);
  const content = jsonText(notification.content);
  const bucket = jsonText(action?.bucketName);
  const key = jsonText(action?.objectKey);

  return {
    notification,
    content: content === undefined
      ? undefined
      : jsonText(action?.encoding)?.toUpperCase() === "BASE64" ? decodeBase64(content) : utf8Bytes(content),
    s3: bucket && key ? { bucket, key } : undefined,
  };
}

function sesSecurity(receipt: JsonObject | undefined): InboundSecurity {
  return {
    spf: sesVerdict(receipt, "spfVerdict"),
    dkim: sesVerdict(receipt, "dkimVerdict"),
    dmarc: sesVerdict(receipt, "dmarcVerdict"),
    spam: sesVerdict(receipt, "spamVerdict"),
    virus: sesVerdict(receipt, "virusVerdict"),
  };
}

/** Build an `InboundEmail` from an SES notification and the raw message bytes. */
export function sesEmailFromNotification(received: SesReceivedNotification, raw: Uint8Array): InboundEmail {
  const receipt = jsonObject(received.notification.receipt);
  const mail = jsonObject(received.notification.mail);
  const value: JsonValue = received.notification;

  const email = emailFromMime({
    provider,
    raw,
    id: jsonText(mail?.messageId),
    envelope: {
      from: jsonText(mail?.source),
      to: jsonList(receipt?.recipients).flatMap(entry => jsonText(entry) ?? []),
    },
    security: sesSecurity(receipt),
    payload: { kind: "json", value },
  });

  return email;
}

/** Object metadata the S3 encryption client writes: the wrapped key (v1 and v2) and the cipher. */
const S3_ENCRYPTION_METADATA = ["x-amz-meta-x-amz-key", "x-amz-meta-x-amz-key-v2", "x-amz-meta-x-amz-cek-alg"];

/**
 * Percent-encode one S3 key segment the way SigV4 canonicalizes it: every byte except the
 * unreserved set `A-Z a-z 0-9 - _ . ~`. `encodeURIComponent` leaves `!'()*` alone, which S3
 * signs as escaped, so those would not match.
 */
function s3PathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, char => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** Download a message an SES S3 receipt action stored, signed with SigV4. */
export async function fetchSesInboundFromS3(location: SesS3Location, options: SesInboundS3Options): Promise<Uint8Array> {
  const segments = location.key.split("/");

  // URL parsing collapses `.` and `..` segments, which would sign and fetch a different key.
  if (segments.some(segment => segment === "." || segment === "..")) {
    throw payloadError(provider, "SES S3 object key has a . or .. path segment and cannot be fetched by URL.");
  }

  const path = segments.map(s3PathSegment).join("/");
  const bucket = s3PathSegment(location.bucket);

  // The S3 wildcard certificate covers one label, so dotted bucket names need path-style URLs.
  const url = options.endpoint
    ? new URL(`${options.endpoint.replace(/\/$/, "")}/${bucket}/${path}`)
    : location.bucket.includes(".")
      ? new URL(`https://s3.${options.region}.amazonaws.com/${bucket}/${path}`)
      : new URL(`https://${location.bucket}.s3.${options.region}.amazonaws.com/${path}`);

  const headers = await signAwsRequest(s3SigningKeys, {
    accessKeyId: options.accessKeyId,
    secretAccessKey: options.secretAccessKey,
    sessionToken: options.sessionToken,
    region: options.region,
    service: "s3",
    method: "GET",
    url,
    body: "",
    headers: {},
  });

  const response = await providerFetch(provider, url, { headers, fetch: options.fetch, signal: options.signal });

  // SES "Message encryption" stores mail through the S3 encryption client, which keeps the
  // wrapped data key in object metadata. The body is ciphertext only that client can decrypt.
  if (S3_ENCRYPTION_METADATA.some(name => response.headers.has(name))) {
    // Release the connection; Node's fetch holds it until the unread body is consumed.
    void response.body?.cancel().catch(() => {});

    throw new InboundError(
      "SES encrypted this message with KMS before storing it in S3. Decrypt it with the S3 encryption client and pass the MIME to sesEmailFromNotification.",
      { reason: "unsupported", provider },
    );
  }

  return new Uint8Array(await response.arrayBuffer());
}

export interface SesInboundOptions extends SnsVerificationOptions {
  /** Credentials for S3 receipt actions. Without them, S3-stored mail cannot be read. */
  s3?: SesInboundS3Options;
  /** Skip SNS signature verification. Only for trusted transports such as SQS or Lambda. */
  skipVerification?: boolean;
  /**
   * Accept SNS messages from any topic. A valid SNS signature only proves that some AWS
   * account's topic sent the message, so leave this off and set `topicArn` instead.
   */
  allowAnyTopic?: boolean;
}

/** Throw unless the caller pinned a topic or explicitly accepted any topic. */
export function assertSesTopicConfigured(options: SesInboundOptions): void {
  if (options.skipVerification || options.allowAnyTopic === true) return;

  const topics = options.topicArn === undefined ? [] : Array.isArray(options.topicArn) ? options.topicArn : [options.topicArn];

  if (!topics.some(Boolean)) {
    throw new InboundError("SES inbound needs topicArn (or allowAnyTopic: true) so other AWS accounts cannot post mail.", {
      reason: "secret_missing",
      provider,
    });
  }
}

/**
 * Verify an SNS delivery and return the received email. Subscription confirmations are
 * not emails; `handleInbound` confirms them for you, and this function throws for them.
 */
export async function parseSesInbound(
  payload: InboundRequestPayload,
  options: SesInboundOptions = {},
): Promise<InboundEmail> {
  assertSesTopicConfigured(options);

  const message = parseSnsMessage(payload.body);

  if (!options.skipVerification) {
    const result = await verifySnsMessage(message, options);

    if (!result.ok) {
      throw new InboundError("SNS message signature is invalid.", { reason: result.reason, provider });
    }
  }

  if (message.Type !== "Notification") {
    throw new InboundError(`SNS ${message.Type} is not an email notification.`, { reason: "unsupported", provider });
  }

  const received = parseSesNotification(message.Message);

  if (received.content) return sesEmailFromNotification(received, received.content);

  if (received.s3 && options.s3) {
    const s3 = { ...options.s3, fetch: options.s3.fetch ?? options.fetch, signal: options.s3.signal ?? options.signal };

    return sesEmailFromNotification(received, await fetchSesInboundFromS3(received.s3, s3));
  }

  throw payloadError(
    provider,
    received.s3
      ? "SES stored this message in S3. Pass s3 credentials to read it."
      : "SES notification has no content. Use an SNS action with content or an S3 action.",
  );
}
