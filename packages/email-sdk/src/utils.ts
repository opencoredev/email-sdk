import { readFile } from "node:fs/promises";

import {
  EmailAbortError,
  EmailAdapterError,
  EmailSdkError,
  EmailValidationError,
} from "./errors.js";
import {
  causeString,
  isJsonObject,
  isJsonString,
  isObjectLike,
  isStringMember,
  readJson,
} from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
import type {
  EmailAddress,
  EmailAdapter,
  EmailAdapterCapabilities,
  EmailAttachment,
  EmailHeader,
  EmailMessage,
  EmailSendResult,
  OneOrMany,
  RecipientVariables,
} from "./types.js";

type LegacyEmailSendResult = Omit<EmailSendResult, "adapter"> & {
  adapter?: string;
  provider?: string;
  messageId?: string;
};

export function normalizeAdapterResult<Name extends string>(
  adapter: Name,
  result: LegacyEmailSendResult,
): EmailSendResult<Name> {
  return {
    // SAFETY: an adapter reports its own name; legacy adapters report it as `provider`.
    // Either way the value names the adapter registered under `Name`.
    adapter: (result.adapter || result.provider || adapter) as Name,
    id: result.id ?? result.messageId,
    accepted: result.accepted,
    rejected: result.rejected,
    raw: result.raw,
  };
}

/**
 * Builds an adapter's static request headers on its first send, then hands each request its
 * own copy. Cloning a Headers object is several times cheaper than parsing a record again,
 * and a fetch wrapper that edits its copy cannot change later requests.
 */
export function headerTemplate(build: () => HeadersInit) {
  let template: Headers | undefined;

  return () => new Headers((template ??= new Headers(build())));
}

export function arrayify<T>(value: OneOrMany<T> | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return isList(value) ? [...value] : [value];
}

function isList<T>(value: OneOrMany<T>): value is readonly T[] {
  return Array.isArray(value);
}

export function formatAddress(address: EmailAddress): string {
  if (isStringMember(address)) {
    return address;
  }

  if (!address.name) {
    return address.email;
  }

  return `${address.name} <${address.email}>`;
}

export function formatAddresses(addresses: OneOrMany<EmailAddress> | undefined): string[] {
  if (addresses === undefined) return [];

  // Map the caller's list directly; arrayify would copy it first.
  return isList(addresses) ? addresses.map(formatAddress) : [formatAddress(addresses)];
}

const ANGLE_ADDRESS = /<([^>]+)>/;

export function emailAddressOf(address: EmailAddress): string {
  if (!isStringMember(address)) {
    return address.email;
  }

  const match = address.includes("<") ? ANGLE_ADDRESS.exec(address) : null;

  return (match?.[1] ?? address).trim();
}

/**
 * Legacy messages may still carry headers as a name-to-value object instead of the
 * `EmailHeader[]` list the v1 types declare.
 */
type HeaderInput = EmailMessage["headers"] | Readonly<Record<string, string>>;

function isHeaderList(headers: NonNullable<HeaderInput>): headers is readonly EmailHeader[] {
  return Array.isArray(headers);
}

export function headersToObject(headers: HeaderInput): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  if (!isHeaderList(headers)) {
    return { ...headers };
  }

  return Object.fromEntries(headers.map((header) => [header.name, header.value]));
}

export function headersToArray(headers: HeaderInput): EmailHeader[] | undefined {
  if (!headers) {
    return undefined;
  }

  if (!isHeaderList(headers)) {
    return Object.entries(headers).map(([name, value]) => ({
      name,
      value,
    }));
  }

  return [...headers];
}

export function assertMessage(message: EmailMessage) {
  if (!message.from) {
    throw new EmailValidationError("Email message requires a from address.");
  }

  if (arrayify(message.to).length === 0) {
    throw new EmailValidationError("Email message requires at least one recipient.");
  }

  if (!message.subject) {
    throw new EmailValidationError("Email message requires a subject.");
  }

  if (!message.html && !message.text) {
    throw new EmailValidationError("Email message requires either html or text content.");
  }

  for (const attachment of message.attachments ?? []) {
    const hasContent = attachment.content !== undefined;
    const hasPath = isStringMember(attachment.path) && attachment.path.length > 0;

    if (hasContent === hasPath) {
      throw new EmailValidationError(
        `Attachment "${attachment.filename}" requires exactly one of content or path.`,
      );
    }
  }

  if (message.sendAt !== undefined) {
    toSendAtDate(message.sendAt);
  }
}

const RFC_3339_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

// Past sendAt values are intentionally allowed: providers either send immediately or reject
// with their own scheduling-window errors, and clock skew makes a client-side cutoff unreliable.
export function toSendAtDate(sendAt: NonNullable<EmailMessage["sendAt"]>): Date {
  if (
    isStringMember(sendAt) &&
    !RFC_3339_TIMESTAMP.test(sendAt)
  ) {
    throw new EmailValidationError(
      `Email message sendAt must be an RFC 3339 timestamp with Z or an explicit offset: "${sendAt}".`,
      { sendAt },
    );
  }

  const date = sendAt instanceof Date ? sendAt : new Date(sendAt);

  if (Number.isNaN(date.getTime())) {
    throw new EmailValidationError(
      `Email message sendAt is not a valid date: "${String(sendAt)}".`,
      { sendAt },
    );
  }

  return date;
}

type LegacyRecipientMessage = EmailMessage & {
  recipientVariables?: RecipientVariables;
};

function recipientVariablesOf(message: LegacyRecipientMessage): RecipientVariables | undefined {
  return message.recipientVariables;
}

export function hasRecipientVariables(message: EmailMessage): boolean {
  const recipientVariables = recipientVariablesOf(message);

  return Boolean(recipientVariables && Object.keys(recipientVariables).length > 0);
}

export function assertRecipientVariables(message: EmailMessage) {
  const recipientVariables = recipientVariablesOf(message);

  if (!hasRecipientVariables(message)) {
    return;
  }

  if (message.cc || message.bcc) {
    throw new EmailValidationError(
      "recipientVariables cannot be combined with cc or bcc because each recipient receives an individualized message.",
    );
  }

  const recipients = new Set<string>();

  for (const recipient of arrayify(message.to)) {
    const address = emailAddressOf(recipient);
    const normalized = address.toLowerCase();

    if (recipients.has(normalized)) {
      throw new EmailValidationError(
        `recipientVariables require unique "to" addresses, but "${address}" appears more than once.`,
      );
    }

    recipients.add(normalized);
  }

  const unknown = Object.keys(recipientVariables ?? {}).filter(
    (address) => !recipients.has(address.toLowerCase()),
  );

  if (unknown.length > 0) {
    throw new EmailValidationError(
      `recipientVariables reference addresses that are not in "to": ${unknown.join(", ")}.`,
      { unknown },
    );
  }

  // 2026-07-06: variable keys must match the fallback substitution token `%recipient.<key>%`
  // (regex [\w-]+). Keys like "user.name" would personalize on native provider routes but
  // silently stay literal in the client-side fallback, so reject them everywhere instead.
  for (const [address, variables] of Object.entries(recipientVariables ?? {})) {
    for (const key of Object.keys(variables)) {
      if (!/^[\w-]+$/.test(key)) {
        throw new EmailValidationError(
          `recipientVariables keys may only contain letters, numbers, underscores, and hyphens, but "${address}" has "${key}".`,
          { address, key },
        );
      }
    }
  }
}

/**
 * Read an error response body: parsed JSON for JSON responses (including `+json` types such as
 * RFC 9457 `application/problem+json`), otherwise the raw text.
 */
export async function readErrorBody(response: Response): Promise<JsonValue | undefined> {
  const contentType = response.headers.get("content-type") ?? "";

  if (/application\/(?:[\w.-]+\+)?json/i.test(contentType)) {
    return readJson(response).catch(() => undefined);
  }

  return response.text().catch(() => undefined);
}

export function httpErrorMessage(provider: string, status: number, body: JsonValue | undefined) {
  if (isJsonObject(body)) {
    const message = body.message ?? body.Message ?? body.error ?? body.ErrorCode;

    if (isJsonString(message)) {
      return `${provider} failed with ${status}: ${message}`;
    }

    const errors = body.errors;

    if (Array.isArray(errors)) {
      const nestedMessage = errors
        .map((error: JsonValue) => (isJsonObject(error) ? error.message : undefined))
        .find(isJsonString);

      if (nestedMessage) {
        return `${provider} failed with ${status}: ${nestedMessage}`;
      }
    }
  }

  return `${provider} failed with HTTP ${status}.`;
}

export function isRetryableStatus(status: number) {
  return status === 408 || status === 409 || status === 425 || status === 429 || status >= 500;
}

export function toProviderError(provider: string, cause: unknown) {
  if (cause instanceof EmailAbortError || cause instanceof EmailValidationError) {
    return cause;
  }

  if (cause instanceof EmailAdapterError) {
    return cause;
  }

  if (cause instanceof EmailSdkError) {
    return new EmailAdapterError(cause.message, {
      adapter: provider,
      retryable: cause.retryable,
      delivery: "unknown",
      cause,
    });
  }

  if (cause instanceof Error) {
    return new EmailAdapterError(cause.message, {
      adapter: provider,
      retryable: isRetryableRuntimeError(cause),
      delivery: "unknown",
      cause,
    });
  }

  return new EmailAdapterError(`${provider} failed with an unknown error.`, {
    adapter: provider,
    retryable: false,
    delivery: "unknown",
    cause,
  });
}

function isRetryableRuntimeError(error: Error) {
  if (error.name === "AbortError") {
    return false;
  }

  const code = causeString(error, "code");

  if (
    code !== undefined &&
    /^(ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EPIPE)$/i.test(code)
  ) {
    return true;
  }

  return /fetch failed|failed to fetch|network|socket|timeout|timed out|connection reset/i.test(
    error.message,
  );
}

export async function attachmentContentToString(
  content: string | Uint8Array | ArrayBuffer | Blob | undefined,
  encoding: "raw" | "base64" = "raw",
) {
  if (content === undefined) {
    return content;
  }

  if (isStringMember(content)) {
    return encoding === "base64" ? content : Buffer.from(content).toString("base64");
  }

  if (content instanceof Blob) {
    const arrayBuffer = await content.arrayBuffer();

    return Buffer.from(arrayBuffer).toString("base64");
  }

  if (content instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(content)).toString("base64");
  }

  return Buffer.from(content).toString("base64");
}

/** Maps attachments concurrently, without a promise round-trip when there are none. */
export function mapAttachments<T>(
  attachments: readonly EmailAttachment[] | undefined,
  map: (attachment: EmailAttachment) => Promise<T>,
): T[] | Promise<T[]> {
  if (!attachments?.length) return [];

  return Promise.all(attachments.map(map));
}

export async function attachmentToBase64(attachment: EmailAttachment) {
  if (attachment.path) {
    return (await readFile(attachment.path)).toString("base64");
  }

  return attachmentContentToString(attachment.content, attachment.contentEncoding);
}

export async function attachmentToBytes(attachment: EmailAttachment) {
  if (attachment.path) {
    return readFile(attachment.path);
  }

  const { content } = attachment;

  if (content === undefined) {
    return Buffer.alloc(0);
  }

  if (isStringMember(content)) {
    return Buffer.from(content, attachment.contentEncoding === "base64" ? "base64" : "utf8");
  }

  if (content instanceof Blob) {
    return Buffer.from(await content.arrayBuffer());
  }

  if (content instanceof ArrayBuffer) {
    return Buffer.from(new Uint8Array(content));
  }

  return Buffer.from(content);
}

export type MessageFieldSupport = Partial<
  Record<
    "cc" | "bcc" | "replyTo" | "headers" | "attachments" | "tags" | "metadata" | "sendAt",
    boolean
  >
>;

export const SUPPORTED_MESSAGE_FIELDS = {
  resend: {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
    sendAt: true,
  },
  postmark: {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
    metadata: true,
  },
  sendgrid: {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
    metadata: true,
    sendAt: true,
  },
  cloudflare: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true },
  unosend: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true },
  ses: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true },
  mailgun: {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
    metadata: true,
    sendAt: true,
  },
  mailersend: {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
    sendAt: true,
  },
  brevo: {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
    metadata: true,
    sendAt: true,
  },
  mailchimp: {
    cc: true,
    bcc: true,
    headers: true,
    attachments: true,
    tags: true,
    metadata: true,
    sendAt: true,
  },
  sparkpost: {
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
    metadata: true,
    sendAt: true,
  },
  iterable: { metadata: true },
  loops: { attachments: true, metadata: true },
  sequenzy: { replyTo: true, attachments: true, metadata: true },
  jetemail: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true },
  lettermint: {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
    metadata: true,
  },
  lettr: {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
    metadata: true,
    sendAt: true,
  },
  primitive: { attachments: true },
  plunk: { replyTo: true, headers: true, attachments: true, metadata: true },
  mailtrap: {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
    metadata: true,
  },
  scaleway: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true },
  zeptomail: { cc: true, bcc: true, replyTo: true, attachments: true },
  mailpace: { cc: true, bcc: true, replyTo: true },
  smtp: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true },
  graph: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true },
  sendheron: {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    sendAt: true,
  },
  helo: {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
    metadata: true,
  },
} satisfies Record<string, MessageFieldSupport>;

const NATIVE_IDEMPOTENCY = new Set(["resend", "jetemail", "lettermint", "primitive", "sendheron", "helo"]);

const REPEATED_HEADERS = new Set(["mailgun", "postmark", "scaleway", "ses", "smtp", "graph"]);

const NATIVE_PERSONALIZED = new Set(["mailgun", "sendgrid"]);

// SAFETY: the entries map every key of SUPPORTED_MESSAGE_FIELDS to its capabilities, so the
// rebuilt object has exactly those keys.
export const BUILT_IN_ADAPTER_CAPABILITIES = Object.fromEntries(
  Object.entries(SUPPORTED_MESSAGE_FIELDS).map(([name, fields]) => [
    name,
    {
      repeatedHeaders: REPEATED_HEADERS.has(name),
      idempotency: NATIVE_IDEMPOTENCY.has(name)
        ? "native"
        : name === "smtp"
          ? "message_id"
          : "none",
      scheduling: "sendAt" in fields && fields.sendAt === true,
      personalized: NATIVE_PERSONALIZED.has(name) ? "native" : "expanded",
    } satisfies EmailAdapterCapabilities,
  ]),
) as Record<BuiltInAdapterName, EmailAdapterCapabilities>;

export type BuiltInAdapterName = keyof typeof SUPPORTED_MESSAGE_FIELDS;

/** Checks a built-in adapter runs after the shared field-support and header checks. */
export type MessageRules = (message: EmailMessage) => void;

/**
 * Built-in adapters with provider limits beyond field support and header repetition. Each
 * keeps its rules in its own module, so importing one adapter does not bundle every
 * provider's limits; the compiler makes each of these supply them.
 */
type RuledAdapterName =
  | "brevo"
  | "cloudflare"
  | "graph"
  | "helo"
  | "iterable"
  | "jetemail"
  | "lettermint"
  | "lettr"
  | "loops"
  | "mailersend"
  | "mailtrap"
  | "plunk"
  | "postmark"
  | "primitive"
  | "scaleway"
  | "sendheron"
  | "sequenzy"
  | "smtp"
  | "unosend";

export type AdapterRules<Name extends BuiltInAdapterName> = Name extends RuledAdapterName
  ? [rules: MessageRules]
  : [];

/** The `rules` option for factories, such as jsonProvider, that build a built-in adapter. */
export type AdapterRulesOption<Name extends BuiltInAdapterName> = Name extends RuledAdapterName
  ? { rules: MessageRules }
  : { rules?: undefined };

export function builtInAdapterDefinition<Name extends BuiltInAdapterName>(
  name: Name,
  ...rules: AdapterRules<Name>
): Pick<EmailAdapter<Name>, "capabilities" | "validate"> {
  const checks: readonly MessageRules[] = rules;

  return {
    capabilities: BUILT_IN_ADAPTER_CAPABILITIES[name],
    validate(message) {
      validateBuiltInMessage(name, message, checks[0]);
    },
  };
}

// The CommonJS build bundles each entry point on its own, so a client from
// "@opencoredev/email-sdk" and an adapter from "@opencoredev/email-sdk/resend"
// hold different copies of these objects. A registered symbol is the same in
// every copy, so it marks them instead of object identity.
const BUILT_IN_ADAPTER_MARK = Symbol.for("@opencoredev/email-sdk/built-in-adapter");

for (const capabilities of Object.values(BUILT_IN_ADAPTER_CAPABILITIES)) {
  Object.defineProperty(capabilities, BUILT_IN_ADAPTER_MARK, { value: true });
}

/**
 * True for adapters an SDK factory built. Every factory takes its capabilities
 * object from BUILT_IN_ADAPTER_CAPABILITIES, so the mark proves where the
 * adapter came from; a caller can name their own adapter "resend".
 */
export function isBuiltInAdapter(adapter: EmailAdapter | undefined) {
  // Plain JavaScript callers can register an adapter without capabilities.
  const capabilities: unknown = adapter?.capabilities;

  return isObjectLike(capabilities) && Object.hasOwn(capabilities, BUILT_IN_ADAPTER_MARK);
}

export function validateBuiltInAdapter<Name extends BuiltInAdapterName>(
  adapter: Name,
  message: EmailMessage,
  ...rules: AdapterRules<Name>
) {
  const checks: readonly MessageRules[] = rules;
  validateBuiltInMessage(adapter, message, checks[0]);
}

/** Shared built-in checks, then the adapter's own rules. Prefer the typed entry points. */
export function validateBuiltInMessage(
  adapter: BuiltInAdapterName,
  message: EmailMessage,
  rules: MessageRules | undefined,
) {
  assertMessage(message);
  assertSupportedMessageFields(adapter, message, SUPPORTED_MESSAGE_FIELDS[adapter]);

  if (!BUILT_IN_ADAPTER_CAPABILITIES[adapter].repeatedHeaders) {
    assertUniqueHeaderNames(adapter, message.headers);
  }

  rules?.(message);
}

const NO_HEADERS: readonly EmailHeader[] = [];

/** Headers as a list, without copying when they already are one. */
export function headerList(headers: HeaderInput): readonly EmailHeader[] {
  if (!headers) return NO_HEADERS;

  return isHeaderList(headers) ? headers : (headersToArray(headers) ?? NO_HEADERS);
}

function assertUniqueHeaderNames(adapter: string, headers: HeaderInput) {
  const list = headerList(headers);

  if (list.length < 2) return;

  const names = new Set<string>();

  for (const header of list) {
    const normalized = header.name.toLowerCase();

    if (names.has(normalized)) {
      throw new EmailValidationError(
        `${adapter} does not support repeated email header names: ${header.name}.`,
      );
    }

    names.add(normalized);
  }
}

/** to, cc, and bcc as one list, in that order. */
export function allRecipients(message: EmailMessage): EmailAddress[] {
  return [...arrayify(message.to), ...arrayify(message.cc), ...arrayify(message.bcc)];
}

export function hasDisplayName(address: EmailAddress) {
  return isStringMember(address) ? address.includes("<") : Boolean(address.name);
}

export function assertSupportedMessageFields(
  adapter: string,
  message: EmailMessage,
  supported: MessageFieldSupport,
) {
  const unsupported: string[] = [];

  if (hasOptionalRecipients(message.cc) && !supported.cc) unsupported.push("cc");

  if (hasOptionalRecipients(message.bcc) && !supported.bcc) unsupported.push("bcc");

  if (hasOptionalRecipients(message.replyTo) && !supported.replyTo) unsupported.push("replyTo");

  if (hasValues(message.headers) && !supported.headers) unsupported.push("headers");

  if (message.attachments?.length && !supported.attachments) unsupported.push("attachments");

  if (message.tags?.length && !supported.tags) unsupported.push("tags");

  if (hasValues(message.metadata) && !supported.metadata) unsupported.push("metadata");

  if (message.sendAt !== undefined && !supported.sendAt) unsupported.push("sendAt");

  if (unsupported.length > 0) {
    throw new EmailValidationError(
      `${adapter} does not support these EmailMessage fields: ${unsupported.join(", ")}.`,
      { adapter, unsupported },
    );
  }
}

export function assertMaxItems<T>(
  adapter: string,
  field: string,
  values: readonly T[],
  max: number,
) {
  if (values.length <= max) {
    return;
  }

  throw new EmailValidationError(
    `${adapter} only supports ${max} ${field}${max === 1 ? "" : "s"} per message.`,
    { adapter, field, max, count: values.length },
  );
}

function hasValues(value: EmailMessage["headers"] | EmailMessage["metadata"] | undefined) {
  if (!value) {
    return false;
  }

  if (Array.isArray(value)) {
    return value.length > 0;
  }

  return Object.keys(value).length > 0;
}

function hasOptionalRecipients(
  value: EmailMessage["cc"] | EmailMessage["bcc"] | EmailMessage["replyTo"] | undefined,
) {
  return Array.isArray(value) ? value.length > 0 : value !== undefined;
}
