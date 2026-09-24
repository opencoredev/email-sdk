import type {
  EmailAddress as V1EmailAddress,
  EmailEnvelope as V1EmailEnvelope,
  EmailMessage as V1EmailMessage,
  EmailPersonalizedInput,
  EmailSendOptions as V1EmailSendOptions,
  EmailSendResult as V1EmailSendResult,
} from "../types.js";
import { isStringMember } from "../internal/decode.js";
import type { EmailAddress, EmailMessage, LegacyEmailResult, SendOptions } from "../compat.js";
import { warnOnce } from "./warn.js";

export function toV1Message(message: EmailMessage): V1EmailMessage {
  const headers = Array.isArray(message.headers)
    ? message.headers
    : Object.entries(message.headers ?? {}).map(([name, value]) => ({ name, value }));

  // SAFETY: legacy messages may omit both html and text or carry a loose sendAt string, but
  // createV1EmailClient validates every message (html or text present, sendAt parseable)
  // before any adapter, hook, or middleware receives it.
  return {
    from: message.from,
    to: message.to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    cc: message.cc,
    bcc: message.bcc,
    replyTo: message.replyTo,
    headers,
    attachments: message.attachments,
    tags: message.tags,
    metadata: message.metadata,
    sendAt: message.sendAt,
  } as V1EmailMessage;
}

/** A v1 message whose html/text discriminant may have been lost, e.g. through `Omit`. */
type V1MessageFields = V1EmailEnvelope & { html?: string; text?: string };

export function toLegacyMessage(message: V1MessageFields): EmailMessage {
  return {
    from: message.from,
    to: mutableAddresses(message.to),
    subject: message.subject,
    html: message.html,
    text: message.text,
    cc: optionalAddresses(message.cc),
    bcc: optionalAddresses(message.bcc),
    replyTo: optionalAddresses(message.replyTo),
    headers: message.headers ? [...message.headers] : undefined,
    attachments: message.attachments ? [...message.attachments] : undefined,
    tags: message.tags ? [...message.tags] : undefined,
    metadata: message.metadata,
    sendAt: message.sendAt,
  };
}

function isAddressList(
  value: V1EmailAddress | readonly V1EmailAddress[],
): value is readonly V1EmailAddress[] {
  return Array.isArray(value);
}

function mutableAddresses(
  value: V1EmailAddress | readonly V1EmailAddress[],
): EmailAddress | EmailAddress[] {
  return isAddressList(value) ? [...value] : value;
}

function optionalAddresses(
  value: V1EmailAddress | readonly V1EmailAddress[] | undefined,
): EmailAddress | EmailAddress[] | undefined {
  return value === undefined ? undefined : mutableAddresses(value);
}

export function toV1Options(
  message: EmailMessage,
  options: SendOptions | undefined,
): V1EmailSendOptions | undefined {
  if (!options && !message.idempotencyKey) return undefined;

  if (message.idempotencyKey) {
    warnOnce("message-idempotency", "Move idempotencyKey to the send options argument.");
  }

  if (options?.provider) warnOnce("send-provider", "Use send option adapter instead of provider.");

  if (options?.retries !== undefined) warnOnce("send-retries", "Use retry.maxAttempts instead.");
  const fallbacks = options?.fallbackAdapters ?? options?.fallbackProviders;

  return {
    adapter: options?.adapter ?? options?.provider,
    fallback: fallbacks ? { adapters: fallbacks, onUnknownDelivery: "stop" } : undefined,
    retry: options?.retries === undefined ? undefined : { maxAttempts: options.retries + 1 },
    signal: options?.signal,
    idempotencyKey: options?.idempotencyKey ?? message.idempotencyKey,
    metadata: options?.metadata,
  };
}

export function toLegacyOptions(options: V1EmailSendOptions | undefined): SendOptions | undefined {
  if (!options) return undefined;

  return {
    adapter: options.adapter,
    fallbackAdapters: options.fallback?.adapters ? [...options.fallback.adapters] : undefined,
    retries:
      options.retry?.maxAttempts === undefined
        ? undefined
        : Math.max(0, options.retry.maxAttempts - 1),
    signal: options.signal,
    idempotencyKey: options.idempotencyKey,
    metadata: options.metadata ? { ...options.metadata } : undefined,
  };
}

export function toPersonalizedInput(message: EmailMessage): EmailPersonalizedInput {
  const { recipientVariables = {}, to, cc: _cc, bcc: _bcc, ...base } = message;

  const recipients = (Array.isArray(to) ? to : [to]).map((address) => ({
    to: address,
    variables: recipientVariables[mailbox(address)] ?? {},
  }));

  return {
    message: toV1Message({ ...base, to }),
    recipients,
  };
}

export function toLegacyBulkMessage(input: EmailPersonalizedInput): EmailMessage {
  const to = input.recipients.map((recipient) => recipient.to);

  return {
    ...toLegacyMessage({ ...input.message, to }),
    recipientVariables: Object.fromEntries(
      input.recipients.map((recipient) => [mailbox(recipient.to), recipient.variables]),
    ),
  };
}

export function mailbox(address: EmailAddress): string {
  return isStringMember(address)
    ? (address.match(/<([^>]+)>/)?.[1] ?? address).trim()
    : address.email;
}

export function withLegacyResult(result: V1EmailSendResult): LegacyEmailResult {
  // SAFETY: the defineProperties call below adds the only LegacyEmailResult members missing
  // from the spread v1 result: the provider and messageId aliases.
  const legacy = { ...result } as LegacyEmailResult;
  Object.defineProperties(legacy, {
    provider: { enumerable: false, get: () => result.adapter },
    messageId: { enumerable: false, get: () => result.id },
  });

  return legacy;
}
