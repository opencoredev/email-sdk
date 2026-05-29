import { firstString, jsonProvider } from "./http.js";
import {
  apiAddress,
  apiAddresses,
  base64Attachments,
  commonHeadersObject,
  optionalApiAddresses,
} from "./payloads.js";
import type { EmailProvider } from "./types.js";
import { assertMaxItems, assertSupportedMessageFields } from "./utils.js";

export type MailtrapProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function mailtrap(options: MailtrapProviderOptions): EmailProvider<{ baseUrl: string }> {
  return jsonProvider({
    name: "mailtrap",
    baseUrl: options.baseUrl ?? "https://send.api.mailtrap.io",
    endpoint: "/api/send",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    fetch: options.fetch,
    async buildPayload(message) {
      assertSupportedMessageFields("mailtrap", message, {
        cc: true,
        bcc: true,
        headers: true,
        attachments: true,
        tags: true,
      });
      assertMaxItems("mailtrap", "tag", message.tags ?? [], 1);
      const attachments = await base64Attachments(message);

      return {
        from: apiAddress(message.from),
        to: apiAddresses(message.to),
        cc: optionalApiAddresses(message.cc),
        bcc: optionalApiAddresses(message.bcc),
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: commonHeadersObject(message),
        category: message.tags?.[0]?.value,
        attachments: attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          type: attachment.contentType,
          disposition: attachment.disposition,
          content_id: attachment.contentId,
        })),
      };
    },
    parseResponse(body) {
      return {
        provider: "mailtrap",
        id: firstString(body as Record<string, unknown>, ["message_id", "id"]),
        messageId: firstString(body as Record<string, unknown>, ["message_id", "id"]),
        raw: body,
      };
    },
  });
}
