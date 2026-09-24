import { EmailAdapterError } from "./errors.js";
import { firstString, jsonProvider } from "./http.js";
import { jsonField, jsonString } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
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

export function unosend(
  options: UnosendAdapterOptions,
): EmailAdapter<"unosend", { baseUrl: string }> {
  return jsonProvider({
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
      if (jsonField(body, "success") !== true) {
        throw new EmailAdapterError(unosendErrorMessage(body), {
          adapter: "unosend",
          retryable: false,
        });
      }

      const id = firstString(jsonField(body, "data") ?? body, ["id"]);

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

function unosendErrorMessage(body: JsonValue) {
  const message = jsonString(jsonField(body, "error"), "message");

  return message ? `unosend failed: ${message}` : "unosend failed.";
}
