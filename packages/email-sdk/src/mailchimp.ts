import { firstString, jsonProvider } from "./http.js";
import { base64Attachments, emailParts } from "./payloads.js";
import type { EmailAddress, EmailProvider, OneOrMany } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertSupportedMessageFields,
  headersToObject,
} from "./utils.js";

export type MailchimpProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function mailchimp(options: MailchimpProviderOptions): EmailProvider<{ baseUrl: string }> {
  return jsonProvider({
    name: "mailchimp",
    baseUrl: options.baseUrl ?? "https://mandrillapp.com/api/1.0",
    endpoint: "/messages/send",
    headers: {},
    fetch: options.fetch,
    async buildPayload(message) {
      assertSupportedMessageFields("mailchimp", message, SUPPORTED_MESSAGE_FIELDS.mailchimp);
      const from = emailParts(message.from);
      const attachments = await base64Attachments(message);

      return {
        key: options.apiKey,
        message: {
          from_email: from.email,
          from_name: from.name,
          to: [
            ...mailchimpRecipients(message.to, "to"),
            ...mailchimpRecipients(message.cc, "cc"),
            ...mailchimpRecipients(message.bcc, "bcc"),
          ],
          headers: headersToObject(message.headers),
          subject: message.subject,
          html: message.html,
          text: message.text,
          metadata: message.metadata,
          tags: message.tags?.map((tag) => tag.value),
          attachments: attachments?.map((attachment) => ({
            type: attachment.contentType ?? "application/octet-stream",
            name: attachment.filename,
            content: attachment.content,
          })),
          important: false,
        },
      };
    },
    parseResponse(body) {
      const first = Array.isArray(body)
        ? (body[0] as Record<string, unknown> | undefined)
        : undefined;

      return {
        provider: "mailchimp",
        id: first ? firstString(first, ["_id", "id"]) : undefined,
        messageId: first ? firstString(first, ["_id", "id"]) : undefined,
        raw: body,
      };
    },
  });
}

function mailchimpRecipients(
  addresses: OneOrMany<EmailAddress> | undefined,
  type: "to" | "cc" | "bcc",
) {
  if (!addresses) {
    return [];
  }

  return (Array.isArray(addresses) ? addresses : [addresses]).map((address) => {
    const parsed = emailParts(address);

    return {
      email: parsed.email,
      name: parsed.name,
      type,
    };
  });
}
