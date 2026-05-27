import { firstString, jsonProvider } from "./http.js";
import {
  apiAddress,
  apiAddresses,
  base64Attachments,
  commonHeadersObject,
  optionalApiAddresses,
} from "./payloads.js";
import type { EmailProvider } from "./types.js";

export type BrevoProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function brevo(options: BrevoProviderOptions): EmailProvider<{ baseUrl: string }> {
  return jsonProvider({
    name: "brevo",
    baseUrl: options.baseUrl ?? "https://api.brevo.com",
    endpoint: "/v3/smtp/email",
    headers: {
      "api-key": options.apiKey,
    },
    fetch: options.fetch,
    async buildPayload(message) {
      const attachments = await base64Attachments(message);

      return {
        sender: apiAddress(message.from),
        to: apiAddresses(message.to),
        cc: optionalApiAddresses(message.cc),
        bcc: optionalApiAddresses(message.bcc),
        replyTo: optionalApiAddresses(message.replyTo)?.[0],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        headers: commonHeadersObject(message),
        params: message.metadata,
        tags: message.tags?.map((tag) => tag.value),
        attachment: attachments?.map((attachment) => ({
          name: attachment.filename,
          content: attachment.content,
        })),
      };
    },
    parseResponse(body) {
      return {
        provider: "brevo",
        id: firstString(body as Record<string, unknown>, ["messageId", "id"]),
        messageId: firstString(body as Record<string, unknown>, ["messageId", "id"]),
        raw: body,
      };
    },
  });
}
