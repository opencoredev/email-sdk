import { createHash } from "node:crypto";

import type { EmailAddress, EmailMessage } from "@opencoredev/email-sdk";

import type {
  EmailMcpMessageInput,
  EmailMcpPolicyLimits,
  EmailMcpPolicyOptions,
  EmailMcpValidationSummary,
} from "./types.js";

const DEFAULT_POLICY = {
  maxRecipients: 10,
  maxSubjectLength: 200,
  maxTextLength: 4_000,
  maxHtmlLength: 4_000,
  validationTtlMs: 5 * 60_000,
  maxPendingValidations: 1_000,
  approvalTimeoutMs: 60_000,
} as const;

export const APPROVAL_BODY_MAX_LENGTH = DEFAULT_POLICY.maxTextLength;

export type ResolvedEmailMcpPolicy = {
  allowedRecipients: ReadonlySet<string>;
  allowedDomains: ReadonlySet<string>;
  limits: EmailMcpPolicyLimits;
};

export function resolvePolicy(options: EmailMcpPolicyOptions = {}): ResolvedEmailMcpPolicy {
  const allowedRecipients = new Set(
    (options.allowedRecipients ?? []).map((value) => requireMailbox(value)),
  );
  const allowedDomains = new Set(
    (options.allowedDomains ?? []).map((value) => value.trim().toLowerCase()).filter(Boolean),
  );

  return {
    allowedRecipients,
    allowedDomains,
    limits: {
      maxRecipients: positiveInteger(options.maxRecipients, DEFAULT_POLICY.maxRecipients),
      maxSubjectLength: positiveInteger(
        options.maxSubjectLength,
        DEFAULT_POLICY.maxSubjectLength,
      ),
      maxTextLength: boundedBodyLength(options.maxTextLength, DEFAULT_POLICY.maxTextLength),
      maxHtmlLength: boundedBodyLength(options.maxHtmlLength, DEFAULT_POLICY.maxHtmlLength),
      validationTtlMs: positiveInteger(
        options.validationTtlMs,
        DEFAULT_POLICY.validationTtlMs,
      ),
      maxPendingValidations: positiveInteger(
        options.maxPendingValidations,
        DEFAULT_POLICY.maxPendingValidations,
      ),
      approvalTimeoutMs: positiveInteger(
        options.approvalTimeoutMs,
        DEFAULT_POLICY.approvalTimeoutMs,
      ),
      recipientAllowlistConfigured: allowedRecipients.size > 0,
      domainAllowlistConfigured: allowedDomains.size > 0,
    },
  };
}

export function toMessage(input: EmailMcpMessageInput, sender: string): EmailMessage {
  const message = {
    from: sender,
    to: addressList(input.to),
    subject: input.subject,
    ...(input.cc ? { cc: addressList(input.cc) } : {}),
    ...(input.bcc ? { bcc: addressList(input.bcc) } : {}),
    ...(input.replyTo ? { replyTo: addressList(input.replyTo) } : {}),
    ...(input.text !== undefined ? { text: input.text } : {}),
    ...(input.html !== undefined ? { html: input.html } : {}),
  };

  return message as EmailMessage;
}

export function validatePolicy(message: EmailMessage, policy: ResolvedEmailMcpPolicy): boolean {
  const to = addressList(message.to);
  const cc = addressList(message.cc);
  const bcc = addressList(message.bcc);
  const recipients = [...to, ...cc, ...bcc];
  const { limits } = policy;

  if (
    recipients.length > limits.maxRecipients ||
    message.subject.length > limits.maxSubjectLength ||
    (message.text?.length ?? 0) > limits.maxTextLength ||
    (message.html?.length ?? 0) > limits.maxHtmlLength
  ) {
    return false;
  }

  if (!limits.recipientAllowlistConfigured && !limits.domainAllowlistConfigured) {
    return true;
  }

  return recipients.every((address) => {
    const mailbox = parseMailbox(address);
    if (!mailbox) return false;
    const domain = mailbox.slice(mailbox.lastIndexOf("@") + 1);
    return policy.allowedRecipients.has(mailbox) || policy.allowedDomains.has(domain);
  });
}

export function validationSummary(
  adapter: string,
  message: EmailMessage,
): EmailMcpValidationSummary {
  return {
    adapter,
    recipientCount: addressList(message.to).length,
    ccCount: addressList(message.cc).length,
    bccCount: addressList(message.bcc).length,
    hasText: message.text !== undefined,
    hasHtml: message.html !== undefined,
    attachmentCount: 0,
  };
}

export function canonicalMessage(message: EmailMessage): string {
  return JSON.stringify({
    from: message.from,
    to: addressList(message.to),
    cc: addressList(message.cc),
    bcc: addressList(message.bcc),
    replyTo: addressList(message.replyTo),
    subject: message.subject,
    text: message.text ?? null,
    html: message.html ?? null,
  });
}

export function messageDigest(message: EmailMessage): string {
  return sha256(canonicalMessage(message));
}

export function policyVersion(
  adapter: string,
  sender: string | undefined,
  policy: ResolvedEmailMcpPolicy,
): string {
  return sha256(
    JSON.stringify({
      adapter,
      sender: sender ?? null,
      allowedRecipients: [...policy.allowedRecipients].sort(),
      allowedDomains: [...policy.allowedDomains].sort(),
      limits: policy.limits,
    }),
  );
}

export function freezeMessage(message: EmailMessage): EmailMessage {
  const copy = JSON.parse(canonicalMessage(message)) as {
    from: string;
    to: string[];
    cc: string[];
    bcc: string[];
    replyTo: string[];
    subject: string;
    text: string | null;
    html: string | null;
  };

  return Object.freeze({
    from: copy.from,
    to: Object.freeze(copy.to),
    subject: copy.subject,
    ...(copy.cc.length > 0 ? { cc: Object.freeze(copy.cc) } : {}),
    ...(copy.bcc.length > 0 ? { bcc: Object.freeze(copy.bcc) } : {}),
    ...(copy.replyTo.length > 0 ? { replyTo: Object.freeze(copy.replyTo) } : {}),
    ...(copy.text !== null ? { text: copy.text } : {}),
    ...(copy.html !== null ? { html: copy.html } : {}),
  }) as EmailMessage;
}

export function addressList(
  value: EmailAddress | readonly EmailAddress[] | undefined,
): string[] {
  if (value === undefined) {
    return [];
  }

  return (Array.isArray(value) ? value : [value]).map((address) =>
    typeof address === "string"
      ? address.trim()
      : address.name
        ? `${address.name} <${address.email}>`
        : address.email,
  );
}

export function isSingleMailbox(value: string): boolean {
  return parseMailbox(value) !== undefined;
}

function requireMailbox(value: string): string {
  const mailbox = parseMailbox(value);
  if (!mailbox) {
    throw new TypeError("Invalid allowed recipient mailbox.");
  }
  return mailbox;
}

function parseMailbox(value: string): string | undefined {
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) return undefined;
  for (const character of trimmed) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127 || character === "," || character === ";") {
      return undefined;
    }
  }

  const bracketed = /^(?:[^<>]+\s*)?<([^<>]+)>$/.exec(trimmed);
  const mailbox = (bracketed?.[1] ?? trimmed).trim();
  if (/\s|[<>]/.test(mailbox)) return undefined;

  const at = mailbox.indexOf("@");
  if (at <= 0 || at !== mailbox.lastIndexOf("@") || at === mailbox.length - 1) {
    return undefined;
  }

  return mailbox;
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isSafeInteger(value) && (value ?? 0) > 0 ? (value as number) : fallback;
}

function boundedBodyLength(value: number | undefined, fallback: number): number {
  return Math.min(positiveInteger(value, fallback), APPROVAL_BODY_MAX_LENGTH);
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
