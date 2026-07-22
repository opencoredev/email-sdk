import { firstString, jsonProvider } from "./http.js";
import {
  apiAddress,
  apiAddresses,
  base64Attachments,
  commonHeadersArray,
  optionalApiAddresses,
  optionalSingleApiAddress,
  sendAtUnixSeconds,
} from "./payloads.js";
import type { EmailAdapter } from "./types.js";
import { SUPPORTED_MESSAGE_FIELDS, assertSupportedMessageFields } from "./utils.js";

export type MailerSendAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function mailersend(
  options: MailerSendAdapterOptions,
): EmailAdapter<"mailersend", { baseUrl: string }> {
  return jsonProvider({
    name: "mailersend",
    baseUrl: options.baseUrl ?? "https://api.mailersend.com",
    endpoint: "/v1/email",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    fetch: options.fetch,
    async buildPayload(message) {
      assertSupportedMessageFields("mailersend", message, SUPPORTED_MESSAGE_FIELDS.mailersend);
      const attachments = await base64Attachments(message);

      return {
        from: apiAddress(message.from),
        to: apiAddresses(message.to),
        cc: optionalApiAddresses(message.cc),
        bcc: optionalApiAddresses(message.bcc),
        reply_to: optionalSingleApiAddress("mailersend", "replyTo", message.replyTo),
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: commonHeadersArray(message),
        attachments: attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          disposition: attachment.disposition,
          id: attachment.contentId,
        })),
        tags: message.tags?.map((tag) => tag.value),
        send_at: sendAtUnixSeconds(message),
      };
    },
    parseResponse(body, _message, response) {
      return {
        adapter: "mailersend",
        id:
          response.headers.get("x-message-id") ??
          firstString(body as Record<string, unknown>, ["message_id", "id"]),
        raw: body,
      };
    },
  });
}
