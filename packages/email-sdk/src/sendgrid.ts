import { firstString, jsonProvider } from "./http.js";
import {
  apiAddress,
  apiAddresses,
  commonHeadersObject,
  optionalApiAddresses,
  sendgridAttachments,
} from "./payloads.js";
import type { EmailProvider } from "./types.js";

export type SendGridProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function sendgrid(options: SendGridProviderOptions): EmailProvider<{ baseUrl: string }> {
  return jsonProvider({
    name: "sendgrid",
    baseUrl: options.baseUrl ?? "https://api.sendgrid.com",
    endpoint: "/v3/mail/send",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    fetch: options.fetch,
    async buildPayload(message) {
      return {
        personalizations: [
          {
            to: apiAddresses(message.to),
            cc: optionalApiAddresses(message.cc),
            bcc: optionalApiAddresses(message.bcc),
            headers: commonHeadersObject(message),
            custom_args: message.metadata,
          },
        ],
        from: apiAddress(message.from),
        reply_to_list: optionalApiAddresses(message.replyTo),
        subject: message.subject,
        content: [
          ...(message.text ? [{ type: "text/plain", value: message.text }] : []),
          ...(message.html ? [{ type: "text/html", value: message.html }] : []),
        ],
        attachments: await sendgridAttachments(message),
        categories: message.tags?.map((tag) => tag.value),
      };
    },
    parseResponse(body, _message, response) {
      return {
        provider: "sendgrid",
        id:
          firstString(body as Record<string, unknown>, ["id", "message_id"]) ??
          response.headers.get("x-message-id") ??
          undefined,
        raw: body,
      };
    },
  });
}
