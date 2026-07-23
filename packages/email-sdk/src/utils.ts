import { readFile } from "node:fs/promises";

import {
  EmailAbortError,
  EmailAdapterError,
  EmailSdkError,
  EmailValidationError,
} from "./errors.js";
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
    adapter: (result.adapter || result.provider || adapter) as Name,
    id: result.id ?? result.messageId,
    accepted: result.accepted,
    rejected: result.rejected,
    raw: result.raw,
  };
}

export function arrayify<T>(value: OneOrMany<T> | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? [...value] : [value as T];
}

export function formatAddress(address: EmailAddress): string {
  if (typeof address === "string") {
    return address;
  }

  if (!address.name) {
    return address.email;
  }

  return `${address.name} <${address.email}>`;
}

export function formatAddresses(addresses: OneOrMany<EmailAddress> | undefined): string[] {
  return arrayify(addresses).map(formatAddress);
}

export function emailAddressOf(address: EmailAddress): string {
  if (typeof address !== "string") {
    return address.email;
  }

  const match = address.match(/<([^>]+)>/);
  return (match?.[1] ?? address).trim();
}

export function headersToObject(
  headers: EmailMessage["headers"],
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  if (!Array.isArray(headers)) {
    return headers as unknown as Record<string, string>;
  }
  return Object.fromEntries(headers.map((header) => [header.name, header.value]));
}

export function headersToArray(headers: EmailMessage["headers"]): EmailHeader[] | undefined {
  if (!headers) {
    return undefined;
  }

  if (!Array.isArray(headers)) {
    return Object.entries(headers as unknown as Record<string, string>).map(([name, value]) => ({
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
    const hasPath = typeof attachment.path === "string" && attachment.path.length > 0;

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

// Past sendAt values are intentionally allowed: providers either send immediately or reject
// with their own scheduling-window errors, and clock skew makes a client-side cutoff unreliable.
export function toSendAtDate(sendAt: NonNullable<EmailMessage["sendAt"]>): Date {
  if (
    typeof sendAt === "string" &&
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(sendAt)
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

export function hasRecipientVariables(message: EmailMessage): boolean {
  const recipientVariables = (message as LegacyRecipientMessage).recipientVariables;
  return Boolean(recipientVariables && Object.keys(recipientVariables).length > 0);
}

export function assertRecipientVariables(message: EmailMessage) {
  const recipientVariables = (message as LegacyRecipientMessage).recipientVariables;
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

export async function readErrorBody(response: Response): Promise<unknown> {
  const contentType = response.headers.get("content-type") ?? "";

  if (contentType.includes("application/json")) {
    return response.json().catch(() => undefined);
  }

  return response.text().catch(() => undefined);
}

export function httpErrorMessage(provider: string, status: number, body: unknown) {
  if (body && typeof body === "object") {
    const record = body as Record<string, unknown>;
    const message = record.message ?? record.Message ?? record.error ?? record.ErrorCode;

    if (typeof message === "string") {
      return `${provider} failed with ${status}: ${message}`;
    }

    if (Array.isArray(record.errors)) {
      const nestedMessage = record.errors
        .map((error) =>
          error && typeof error === "object"
            ? (error as Record<string, unknown>).message
            : undefined,
        )
        .find((value): value is string => typeof value === "string");

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

export function toProviderError(provider: string, error: unknown) {
  if (error instanceof EmailAbortError || error instanceof EmailValidationError) {
    return error;
  }

  if (error instanceof EmailAdapterError) {
    return error;
  }

  if (error instanceof EmailSdkError) {
    return new EmailAdapterError(error.message, {
      adapter: provider,
      retryable: error.retryable,
      delivery: "unknown",
      cause: error,
    });
  }

  if (error instanceof Error) {
    return new EmailAdapterError(error.message, {
      adapter: provider,
      retryable: isRetryableRuntimeError(error),
      delivery: "unknown",
      cause: error,
    });
  }

  return new EmailAdapterError(`${provider} failed with an unknown error.`, {
    adapter: provider,
    retryable: false,
    delivery: "unknown",
    cause: error,
  });
}

function isRetryableRuntimeError(error: Error) {
  if (error.name === "AbortError") {
    return false;
  }

  const code = (error as unknown as Record<string, unknown>).code;

  if (
    typeof code === "string" &&
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

  if (typeof content === "string") {
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

  if (typeof content === "string") {
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
  smtp: { cc: true, bcc: true, replyTo: true, headers: true },
} satisfies Record<string, MessageFieldSupport>;

const NATIVE_IDEMPOTENCY = new Set(["resend", "jetemail", "lettermint", "primitive"]);
const REPEATED_HEADERS = new Set(["mailgun", "postmark", "scaleway", "ses", "smtp"]);
const NATIVE_PERSONALIZED = new Set(["mailgun", "sendgrid"]);

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
) as Record<keyof typeof SUPPORTED_MESSAGE_FIELDS, EmailAdapterCapabilities>;

export function builtInAdapterDefinition<Name extends keyof typeof SUPPORTED_MESSAGE_FIELDS>(
  name: Name,
): Pick<EmailAdapter<Name>, "capabilities" | "validate"> {
  return {
    capabilities: BUILT_IN_ADAPTER_CAPABILITIES[name],
    validate(message) {
      validateBuiltInAdapter(name, message);
    },
  };
}

export function validateBuiltInAdapter(
  adapter: keyof typeof SUPPORTED_MESSAGE_FIELDS,
  message: EmailMessage,
) {
  assertMessage(message);
  assertSupportedMessageFields(adapter, message, SUPPORTED_MESSAGE_FIELDS[adapter]);

  const capabilities = BUILT_IN_ADAPTER_CAPABILITIES[adapter];
  const headerNames = new Set<string>();

	for (const header of headersToArray(message.headers) ?? []) {
    const normalized = header.name.toLowerCase();
    if (!capabilities.repeatedHeaders && headerNames.has(normalized)) {
      throw new EmailValidationError(
        `${adapter} does not support repeated email header names: ${header.name}.`,
      );
    }
    headerNames.add(normalized);
  }

  const to = arrayify(message.to);
  const replyTo = arrayify(message.replyTo);

  if (adapter === "loops" || adapter === "iterable" || adapter === "primitive") {
    assertMaxItems(adapter, "recipient", to, 1);
  }
  if (adapter === "jetemail") {
    if (!formatAddress(message.from).includes("<")) {
      const from = emailAddressOf(message.from);
      throw new EmailValidationError(
        `jetemail requires a from address with a display name, for example "Acme <${from}>".`,
      );
    }
    assertMaxItems(adapter, "recipient", to, 50);
    assertMaxItems(adapter, "cc", arrayify(message.cc), 50);
    assertMaxItems(adapter, "bcc", arrayify(message.bcc), 50);
    assertMaxItems(adapter, "replyTo", replyTo, 50);
  }
	if (adapter === "cloudflare") {
    assertMaxItems(
      adapter,
      "recipient",
      [...to, ...arrayify(message.cc), ...arrayify(message.bcc)],
      50,
    );
    assertMaxItems(adapter, "replyTo", replyTo, 1);
		for (const recipient of [...to, ...arrayify(message.cc), ...arrayify(message.bcc)]) {
			if (typeof recipient === "string" ? recipient.includes("<") : Boolean(recipient.name)) {
				throw new EmailValidationError(
					"cloudflare recipient fields only support plain email addresses.",
				);
			}
		}
	}
	if (
		adapter === "brevo" ||
		adapter === "mailersend" ||
		adapter === "mailtrap" ||
		adapter === "plunk" ||
		adapter === "unosend" ||
		adapter === "sequenzy"
	) {
		assertMaxItems(adapter, "replyTo", replyTo, 1);
	}
  if (adapter === "sequenzy") {
    assertMaxItems(adapter, "recipient", to, 50);
  }
  if (adapter === "postmark" || adapter === "lettermint" || adapter === "mailtrap") {
    assertMaxItems(adapter, "tag", [...(message.tags ?? [])], 1);
  }
  if (adapter === "scaleway" && replyTo.length > 0) {
		const hasReplyHeader = (headersToArray(message.headers) ?? []).some(
			(header) => header.name.toLowerCase() === "reply-to",
		);
    if (hasReplyHeader) {
      throw new EmailValidationError(
        "scaleway cannot set replyTo when headers already include Reply-To.",
      );
    }
  }
  if (adapter === "smtp") {
    for (const address of [
      message.from,
      ...to,
      ...arrayify(message.cc),
      ...arrayify(message.bcc),
    ]) {
      const envelope = emailAddressOf(address);
      const hasInvalidCharacter = [...envelope].some((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint <= 0x20 || codePoint >= 0x7f || character === "<" || character === ">";
      });
      if (!envelope || hasInvalidCharacter) {
        throw new EmailValidationError(
          `SMTP envelope address ${JSON.stringify(envelope)} contains invalid characters.`,
        );
      }
    }
		for (const header of headersToArray(message.headers) ?? []) {
			if (header.name.toLowerCase() === "bcc") {
				throw new EmailValidationError("SMTP does not allow Bcc in message headers.");
			}
			if (!/^[!-9;-~]+$/.test(header.name)) {
				throw new EmailValidationError(
					`SMTP header name ${JSON.stringify(header.name)} contains invalid characters.`,
				);
			}
		}
  }
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

export function assertMaxItems(
  adapter: string,
  field: string,
  values: readonly unknown[],
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
