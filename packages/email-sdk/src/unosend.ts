import { EmailAdapterError } from "./errors.js";
import { firstString, jsonProvider } from "./http.js";
import {
  base64Attachments,
  commonHeadersObject,
  formatAddress,
  formatAddresses,
  optionalSingleApiAddress,
  optionalStringAddresses,
} from "./payloads.js";
import type { EmailMessage, EmailAdapter } from "./types.js";
import { SUPPORTED_MESSAGE_FIELDS, assertSupportedMessageFields } from "./utils.js";

export type UnosendAdapterOptions = {
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

export function unosend(
  options: UnosendAdapterOptions,
): EmailAdapter<"unosend", { baseUrl: string }> {
  return jsonProvider<"unosend", UnosendSendResponse>({
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
        cc: optionalStringAddresses(message.cc),
        bcc: optionalStringAddresses(message.bcc),
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
      if (body.success !== true) {
        throw new EmailAdapterError(unosendErrorMessage(body), {
          adapter: "unosend",
          retryable: false,
        });
      }

      const record = (body.data ?? body) as Record<string, unknown>;
      const id = firstString(record, ["id"]);

      return {
        adapter: "unosend",
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

function optionalReplyTo(message: EmailMessage) {
  return formatAddresses(message.replyTo)[0];
}

function unosendErrorMessage(body: UnosendSendResponse) {
  return body.error?.message ? `unosend failed: ${body.error.message}` : "unosend failed.";
}
