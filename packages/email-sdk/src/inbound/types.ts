import type { JsonValue } from "../internal/decode.js";

/** Providers whose inbound email this module can verify, parse, or fetch. */
export type InboundProvider =
  | "brevo"
  | "cloudflare"
  | "graph"
  | "jetemail"
  | "lettermint"
  | "lettr"
  | "mailchimp"
  | "mailersend"
  | "mailgun"
  | "mailpace"
  | "mailtrap"
  | "postmark"
  | "primitive"
  | "resend"
  | "sendgrid"
  | "ses"
  | "sparkpost";

/** Request headers as a `Headers` instance or a plain record from a framework. */
export type InboundHeadersInit = Headers | Readonly<Record<string, string | undefined>>;

/** The raw HTTP request a provider sent to your inbound endpoint. */
export interface InboundRequestPayload {
  /** The unmodified request body. Signatures are computed over these exact bytes. */
  body: string | Uint8Array;
  headers?: InboundHeadersInit;
  /** The full public URL the provider posted to. Mandrill signs it. */
  url?: string;
}

export interface InboundAddress {
  address: string;
  name?: string;
}

export interface InboundHeader {
  name: string;
  value: string;
}

/** Ordered, case-insensitive, multi-value safe message headers. */
export class InboundHeaders implements Iterable<InboundHeader> {
  readonly #entries: readonly InboundHeader[];

  constructor(entries: readonly InboundHeader[] = []) {
    this.#entries = entries.map(entry => ({ name: entry.name, value: entry.value }));
  }

  /** The first value of `name`, or `undefined`. */
  get(name: string): string | undefined {
    const key = name.toLowerCase();

    return this.#entries.find(entry => entry.name.toLowerCase() === key)?.value;
  }

  /** Every value of `name`, in message order (for example each `Received` line). */
  getAll(name: string): string[] {
    const key = name.toLowerCase();

    return this.#entries.flatMap(entry => entry.name.toLowerCase() === key ? [entry.value] : []);
  }

  has(name: string): boolean {
    return this.get(name) !== undefined;
  }

  get size(): number {
    return this.#entries.length;
  }

  entries(): InboundHeader[] {
    return this.#entries.map(entry => ({ name: entry.name, value: entry.value }));
  }

  [Symbol.iterator](): Iterator<InboundHeader> {
    return this.entries()[Symbol.iterator]();
  }

  toJSON(): InboundHeader[] {
    return this.entries();
  }
}

export interface InboundAttachment {
  filename?: string;
  contentType: string;
  /** Size in bytes, when the provider reports it or the content is present. */
  size?: number;
  contentId?: string;
  disposition?: "attachment" | "inline";
  /** Decoded bytes, when the provider delivered them inline. */
  content?: Uint8Array;
  /** A provider download URL, when content is fetched separately. */
  url?: string;
  /** Read the attachment bytes, fetching them from the provider when needed. */
  read(): Promise<Uint8Array>;
}

/** An authentication or content check result, lowercased as the provider reports it. */
export type InboundVerdict =
  | "pass"
  | "fail"
  | "softfail"
  | "neutral"
  | "none"
  | "temperror"
  | "permerror"
  | "gray"
  | "processing_failed"
  | "unknown";

export interface InboundSecurity {
  spf?: InboundVerdict;
  dkim?: InboundVerdict;
  dmarc?: InboundVerdict;
  spam?: InboundVerdict;
  virus?: InboundVerdict;
  /** Provider spam score. Higher means more likely spam; scales differ by provider. */
  spamScore?: number;
}

/** SMTP envelope addresses, which can differ from the From/To headers. */
export interface InboundEnvelope {
  from?: string;
  to: string[];
}

/** The original payload, so nothing the provider sent is lost. */
export type InboundRawPayload =
  | { kind: "json"; value: JsonValue }
  | { kind: "form"; fields: InboundFormFields }
  | { kind: "mime"; bytes: Uint8Array };

/** Text fields of a multipart or urlencoded request, multi-value safe. */
export type InboundFormFields = ReadonlyMap<string, readonly string[]>;

/** One received email, normalized across providers. */
export interface InboundEmail {
  provider: InboundProvider;
  /** The provider's identifier for the received message, when it has one. */
  id?: string;
  /** The RFC 5322 Message-ID, without angle brackets. */
  messageId?: string;
  from?: InboundAddress;
  to: InboundAddress[];
  cc: InboundAddress[];
  /** Only present when the provider exposes envelope-only recipients. */
  bcc: InboundAddress[];
  replyTo: InboundAddress[];
  subject?: string;
  text?: string;
  html?: string;
  headers: InboundHeaders;
  attachments: InboundAttachment[];
  /** Message-ID this message replies to, without angle brackets. */
  inReplyTo?: string;
  references: string[];
  date?: Date;
  security: InboundSecurity;
  envelope?: InboundEnvelope;
  raw: InboundRawPayload;
}

export type InboundErrorReason =
  | "signature_missing"
  | "signature_invalid"
  | "timestamp_expired"
  | "secret_missing"
  | "payload_invalid"
  | "unsupported"
  | "decryption_required"
  | "fetch_failed";

/** Thrown when an inbound request fails verification, parsing, or fetching. */
export class InboundError extends Error {
  readonly reason: InboundErrorReason;
  readonly provider: InboundProvider;
  readonly status?: number;

  constructor(
    message: string,
    options: { reason: InboundErrorReason; provider: InboundProvider; status?: number; cause?: Error },
  ) {
    super(message, { cause: options.cause });
    this.name = "InboundError";
    this.reason = options.reason;
    this.provider = options.provider;
    this.status = options.status;
  }
}

/** Result of a signature check. Failures carry a reason instead of throwing. */
export type InboundVerification =
  | { ok: true }
  | { ok: false; reason: Exclude<InboundErrorReason, "fetch_failed" | "unsupported" | "decryption_required"> };

export interface InboundClockOptions {
  /** Maximum clock skew in seconds for timestamped schemes. Defaults to 300. */
  toleranceSeconds?: number;
  /** Current time in epoch milliseconds, for tests. */
  now?: number;
}

export interface InboundSignatureOptions extends InboundClockOptions {
  /** The signing secret. Pass several during rotation. */
  secret: string | readonly string[];
}

export interface InboundTokenOptions {
  /** The shared token configured on the provider's webhook. Pass several during rotation. */
  secret: string | readonly string[];
}
