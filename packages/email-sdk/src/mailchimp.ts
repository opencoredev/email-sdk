import { EmailAdapterError } from "./errors.js";
import { firstString, jsonProvider } from "./http.js";
import { jsonString } from "./internal/decode.js";
import { base64Attachments, emailParts, sendAtUtcDateTime } from "./payloads.js";
import type { EmailAddress, EmailAdapter, OneOrMany } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertSupportedMessageFields,
  headersToObject,
} from "./utils.js";

export type MailchimpAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function mailchimp(
  options: MailchimpAdapterOptions,
): EmailAdapter<"mailchimp", { baseUrl: string }> {
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
        send_at: sendAtUtcDateTime(message),
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
      const results = Array.isArray(body) ? body : [];
      const first = results[0];
      const accepted: string[] = [];
      const rejected: string[] = [];
      const reasons = new Set<string>();

      // Mandrill answers 200 with one result per recipient; "rejected" and "invalid" were not sent.
      for (const result of results) {
        const email = jsonString(result, "email");
        const status = jsonString(result, "status");

        if (status === "rejected" || status === "invalid") {
          if (email) rejected.push(email);

          reasons.add(jsonString(result, "reject_reason") ?? status);
        } else if (email) {
          accepted.push(email);
        }
      }

      if (results.length && !accepted.length && rejected.length) {
        throw new EmailAdapterError(`Mailchimp Transactional rejected every recipient (${[...reasons].join(", ")}).`, {
          adapter: "mailchimp",
          retryable: false,
          delivery: "not_sent",
          acceptedCount: 0,
          rejectedCount: rejected.length,
          cause: body,
        });
      }

      return {
        adapter: "mailchimp",
        id: first ? firstString(first, ["_id", "id"]) : undefined,
        messageId: first ? firstString(first, ["_id", "id"]) : undefined,
        accepted: results.length ? accepted : undefined,
        rejected: results.length ? rejected : undefined,
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
