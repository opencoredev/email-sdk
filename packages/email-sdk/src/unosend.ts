import { EmailProviderError } from "./errors.js";
import { firstString, jsonProvider } from "./http.js";
import {
  base64Attachments,
  commonHeadersObject,
  formatAddress,
  formatAddresses,
  optionalSingleApiAddress,
} from "./payloads.js";
import type { EmailMessage, EmailProvider } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertSupportedMessageFields,
  formatAddress as formatReplyAddress,
} from "./utils.js";

export type UnosendProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

type UnosendSendResponse = {
  success?: boolean;
  data?: {
    id?: string;
    from?: string;
    to?: string[];
    status?: string;
    created_at?: string;
  };
  error?: {
    code?: string;
    message?: string;
    status?: number;
    details?: unknown;
  };
  id?: string;
  status?: string;
};

export function unosend(options: UnosendProviderOptions): EmailProvider<{ baseUrl: string }> {
  return jsonProvider<UnosendSendResponse>({
    name: "unosend",
    baseUrl: options.baseUrl ?? "https://api.unosend.co",
    endpoint: "/emails",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    fetch: options.fetch,
    async buildPayload(message) {
      assertUnosendMessage(message);
      const attachments = await base64Attachments(message);

      return {
        from: formatAddress(message.from),
        to: formatAddresses(message.to),
        cc: optionalStringRecipients(message.cc),
        bcc: optionalStringRecipients(message.bcc),
        reply_to: optionalReplyTo(message),
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: commonHeadersObject(message),
        tags: message.tags,
        attachments: attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          content_type: attachment.contentType,
        })),
      };
    },
    parseResponse(body) {
      if (body.success === false) {
        throw new EmailProviderError(unosendErrorMessage(body), {
          provider: "unosend",
          retryable: false,
          details: body,
        });
      }

      const record = (body.data ?? body) as Record<string, unknown>;
      const id = firstString(record, ["id"]);

      return {
        provider: "unosend",
        id,
        messageId: id,
        raw: body,
      };
    },
  });
}

export function assertUnosendMessage(message: EmailMessage) {
  assertSupportedMessageFields("unosend", message, SUPPORTED_MESSAGE_FIELDS.unosend);
  optionalSingleApiAddress("unosend", "replyTo", message.replyTo);
}

function optionalStringRecipients(addresses: EmailMessage["cc"]) {
  const formatted = formatAddresses(addresses);
  return formatted.length > 0 ? formatted : undefined;
}

function optionalReplyTo(message: EmailMessage) {
  const address = optionalSingleApiAddress("unosend", "replyTo", message.replyTo);
  return address ? formatReplyAddress(address) : undefined;
}

function unosendErrorMessage(body: UnosendSendResponse) {
  return body.error?.message ? `unosend failed: ${body.error.message}` : "unosend failed.";
}
