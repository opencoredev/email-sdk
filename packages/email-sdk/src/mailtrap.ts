import { firstString, jsonProvider } from "./http.js";
import {
  apiAddress,
  apiAddresses,
  base64Attachments,
  commonHeadersObject,
  optionalApiAddresses,
  optionalSingleApiAddress,
} from "./payloads.js";
import type { EmailMessage, EmailAdapter } from "./types.js";
import { SUPPORTED_MESSAGE_FIELDS, assertMaxItems, assertSupportedMessageFields } from "./utils.js";

export type MailtrapAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function mailtrap(
  options: MailtrapAdapterOptions,
): EmailAdapter<"mailtrap", { baseUrl: string }> {
  return jsonProvider({
    name: "mailtrap",
    baseUrl: options.baseUrl ?? "https://send.api.mailtrap.io",
    endpoint: "/api/send",
    headers: {
      "Api-Token": options.apiKey,
    },
    fetch: options.fetch,
    async buildPayload(message) {
      assertSupportedMessageFields("mailtrap", message, SUPPORTED_MESSAGE_FIELDS.mailtrap);
      assertMaxItems("mailtrap", "tag", message.tags ?? [], 1);
      const attachments = await base64Attachments(message);

      return {
        from: apiAddress(message.from),
        to: apiAddresses(message.to),
        cc: optionalApiAddresses(message.cc),
        bcc: optionalApiAddresses(message.bcc),
        reply_to: optionalSingleApiAddress("mailtrap", "replyTo", message.replyTo),
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: commonHeadersObject(message),
        custom_variables: mailtrapMetadata(message.metadata),
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
      const record = body as Record<string, unknown>;
      const messageIds = Array.isArray(record.message_ids) ? record.message_ids : [];
      const messageId = messageIds.find((value) => typeof value === "string") as string | undefined;

      return {
        adapter: "mailtrap",
        id: messageId ?? firstString(record, ["message_id", "id"]),
        messageId: messageId ?? firstString(record, ["message_id", "id"]),
        raw: body,
      };
    },
  });
}

function mailtrapMetadata(metadata: EmailMessage["metadata"]) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, value === null ? "" : String(value)]),
  );
}
