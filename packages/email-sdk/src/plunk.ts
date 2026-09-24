import { firstString, jsonProvider } from "./http.js";
import { jsonArray, jsonField, jsonString } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
import {
  apiAddress,
  apiAddresses,
  base64Attachments,
  commonHeadersObject,
  optionalSingleApiAddress,
} from "./payloads.js";
import type { EmailAdapter } from "./types.js";
import { SUPPORTED_MESSAGE_FIELDS, assertSupportedMessageFields } from "./utils.js";

export type PlunkAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function plunk(options: PlunkAdapterOptions): EmailAdapter<"plunk", { baseUrl: string }> {
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
      const record = body;

      return {
        adapter: "plunk",
        id: plunkEmailId(record) ?? firstString(record, ["id", "emailId"]),
        raw: body,
      };
    },
  });
}

function plunkEmailId(record: JsonValue) {
  for (const email of jsonArray(jsonField(record, "data"), "emails")) {
    const id = jsonString(email, "email");

    if (id !== undefined) {
      return id;
    }
  }

  return undefined;
}
