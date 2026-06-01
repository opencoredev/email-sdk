import { firstString, jsonProvider } from "./http.js";
import {
  apiAddress,
  apiAddresses,
  base64Attachments,
  commonHeadersObject,
  optionalSingleApiAddress,
} from "./payloads.js";
import type { EmailProvider } from "./types.js";
import { SUPPORTED_MESSAGE_FIELDS, assertSupportedMessageFields } from "./utils.js";

export type PlunkProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function plunk(options: PlunkProviderOptions): EmailProvider<{ baseUrl: string }> {
  return jsonProvider({
    name: "plunk",
    baseUrl: options.baseUrl ?? "https://next-api.useplunk.com",
    endpoint: "/v1/send",
    headers: { Authorization: `Bearer ${options.apiKey}` },
    async buildPayload(message) {
      assertSupportedMessageFields("plunk", message, SUPPORTED_MESSAGE_FIELDS.plunk);
      const attachments = await base64Attachments(message);
      const replyTo = optionalSingleApiAddress("plunk", "replyTo", message.replyTo);

      return {
        to: apiAddresses(message.to),
        from: apiAddress(message.from),
        subject: message.subject,
        body: message.html ?? message.text,
        data: message.metadata,
        headers: commonHeadersObject(message),
        reply: replyTo?.email,
        attachments: attachments?.map((attachment) => ({
          filename: attachment.filename,
          content: attachment.content,
          contentType: attachment.contentType ?? "application/octet-stream",
          contentId: attachment.contentId,
          disposition: attachment.disposition,
        })),
      };
    },
    fetch: options.fetch,
    parseResponse(body) {
      const record = body as Record<string, unknown>;
      return {
        provider: "plunk",
        id: plunkEmailId(record) ?? firstString(record, ["id", "emailId"]),
        raw: body,
      };
    },
  });
}

function plunkEmailId(record: Record<string, unknown>) {
  const data = record.data;

  if (!data || typeof data !== "object") {
    return undefined;
  }

  const emails = (data as Record<string, unknown>).emails;

  if (!Array.isArray(emails)) {
    return undefined;
  }

  for (const email of emails) {
    if (email && typeof email === "object") {
      const id = (email as Record<string, unknown>).email;

      if (typeof id === "string") {
        return id;
      }
    }
  }

  return undefined;
}
