import { EmailProviderError } from "./errors.js";
import { sendAtIso } from "./payloads.js";
import type { EmailAttachment, EmailMessage, EmailProvider } from "./types.js";
import {
  attachmentToBase64,
  formatAddress,
  formatAddresses,
  headersToObject,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
  assertSupportedMessageFields,
  SUPPORTED_MESSAGE_FIELDS,
} from "./utils.js";

export type ResendProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

export function resend(options: ResendProviderOptions): EmailProvider<{ baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.resend.com";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "resend",
    raw: { baseUrl },
    async send(message, context) {
      const response = await fetcher(`${baseUrl}/emails`, {
        method: "POST",
        signal: context.signal,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          ...(context.idempotencyKey ? { "Idempotency-Key": context.idempotencyKey } : {}),
          ...options.headers,
        },
        body: JSON.stringify(await toResendPayload(message)),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailProviderError(httpErrorMessage("Resend", response.status, body), {
          provider: "resend",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          details: body,
        });
      }

      const body = (await response.json()) as { id?: string };

      return {
        provider: "resend",
        id: body.id,
        messageId: body.id,
        raw: body,
      };
    },
  };
}

async function toResendPayload(message: EmailMessage) {
  assertSupportedMessageFields("resend", message, SUPPORTED_MESSAGE_FIELDS.resend);

  return {
    from: formatAddress(message.from),
    to: formatAddresses(message.to),
    subject: message.subject,
    html: message.html,
    text: message.text,
    cc: formatAddresses(message.cc),
    bcc: formatAddresses(message.bcc),
    reply_to: formatAddresses(message.replyTo),
    headers: headersToObject(message.headers),
    attachments: await Promise.all((message.attachments ?? []).map(toResendAttachment)),
    tags: message.tags,
    scheduled_at: sendAtIso(message),
  };
}

async function toResendAttachment(attachment: EmailAttachment) {
  return {
    filename: attachment.filename,
    content: await attachmentToBase64(attachment),
    content_type: attachment.contentType,
    content_id: attachment.contentId,
  };
}
