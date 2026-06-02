import { readFile } from "node:fs/promises";

import { EmailProviderError, EmailValidationError } from "./errors.js";
import type {
  EmailAddress,
  EmailAttachment,
  EmailHeader,
  EmailMessage,
  OneOrMany,
} from "./types.js";

export function arrayify<T>(value: OneOrMany<T> | undefined): T[] {
  if (value === undefined) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
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

export function headersToObject(
  headers: EmailMessage["headers"],
): Record<string, string> | undefined {
  if (!headers) {
    return undefined;
  }

  if (Array.isArray(headers)) {
    return Object.fromEntries(headers.map((header) => [header.name, header.value]));
  }

  return headers;
}

export function headersToArray(headers: EmailMessage["headers"]): EmailHeader[] | undefined {
  if (!headers) {
    return undefined;
  }

  if (Array.isArray(headers)) {
    return headers;
  }

  return Object.entries(headers).map(([name, value]) => ({ name, value }));
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
    if (attachment.content === undefined && !attachment.path) {
      throw new EmailValidationError(
        `Attachment "${attachment.filename}" requires content or path.`,
      );
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
  if (error instanceof EmailProviderError) {
    return error;
  }

  if (error instanceof Error) {
    return new EmailProviderError(error.message, {
      provider,
      retryable: isRetryableRuntimeError(error),
      cause: error,
    });
  }

  return new EmailProviderError(`${provider} failed with an unknown error.`, {
    provider,
    retryable: false,
    details: error,
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
  Record<"cc" | "bcc" | "replyTo" | "headers" | "attachments" | "tags" | "metadata", boolean>
>;

export const SUPPORTED_MESSAGE_FIELDS = {
  resend: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true },
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
  },
  mailersend: { cc: true, bcc: true, replyTo: true, headers: true, attachments: true, tags: true },
  brevo: {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
    metadata: true,
  },
  mailchimp: { cc: true, bcc: true, headers: true, attachments: true, tags: true, metadata: true },
  sparkpost: { replyTo: true, headers: true, attachments: true, tags: true, metadata: true },
  loops: { attachments: true, metadata: true },
  sequenzy: { replyTo: true, attachments: true, metadata: true },
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

export function assertSupportedMessageFields(
  adapter: string,
  message: EmailMessage,
  supported: MessageFieldSupport,
) {
  const unsupported: string[] = [];

  if (message.cc && !supported.cc) unsupported.push("cc");
  if (message.bcc && !supported.bcc) unsupported.push("bcc");
  if (message.replyTo && !supported.replyTo) unsupported.push("replyTo");
  if (hasValues(message.headers) && !supported.headers) unsupported.push("headers");
  if (message.attachments?.length && !supported.attachments) unsupported.push("attachments");
  if (message.tags?.length && !supported.tags) unsupported.push("tags");
  if (hasValues(message.metadata) && !supported.metadata) unsupported.push("metadata");

  if (unsupported.length > 0) {
    throw new EmailValidationError(
      `${adapter} does not support these EmailMessage fields: ${unsupported.join(", ")}.`,
      { adapter, unsupported },
    );
  }
}

export function assertMaxItems(adapter: string, field: string, values: unknown[], max: number) {
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
