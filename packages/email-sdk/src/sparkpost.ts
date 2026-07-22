import { firstString, jsonProvider } from "./http.js";
import {
  apiAddress,
  base64Attachments,
  formatAddresses,
  optionalStringAddresses,
  sendAtIsoUtcSeconds,
} from "./payloads.js";
import type { EmailAdapter } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertSupportedMessageFields,
  headersToObject,
} from "./utils.js";

export type SparkPostAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  sandbox?: boolean;
  fetch?: typeof fetch;
};

export function sparkpost(
  options: SparkPostAdapterOptions,
): EmailAdapter<"sparkpost", { baseUrl: string }> {
  return jsonProvider({
    name: "sparkpost",
    baseUrl: options.baseUrl ?? "https://api.sparkpost.com/api/v1",
    endpoint: "/transmissions",
    headers: {
      Authorization: options.apiKey,
    },
    fetch: options.fetch,
    async buildPayload(message) {
      assertSupportedMessageFields("sparkpost", message, SUPPORTED_MESSAGE_FIELDS.sparkpost);
      const attachments = await base64Attachments(message);

      return {
        options: {
          sandbox: options.sandbox,
          start_time: sendAtIsoUtcSeconds(message),
        },
        recipients: formatAddresses(message.to).map((address) => ({ address })),
        content: {
          from: apiAddress(message.from),
          reply_to: optionalStringAddresses(message.replyTo)?.join(", "),
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: headersToObject(message.headers),
          attachments: attachments?.map((attachment) => ({
            name: attachment.filename,
            type: attachment.contentType ?? "application/octet-stream",
            data: attachment.content,
          })),
        },
        metadata: message.metadata,
        substitution_data: Object.fromEntries(
          message.tags?.map((tag) => [tag.name, tag.value]) ?? [],
        ),
      };
    },
    parseResponse(body) {
      const record = body as Record<string, unknown>;
      const results = record.results as Record<string, unknown> | undefined;

      return {
        adapter: "sparkpost",
        id: results ? firstString(results, ["id", "transmission_id"]) : undefined,
        raw: body,
      };
    },
  });
}
