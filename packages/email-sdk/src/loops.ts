import { firstString, jsonProvider } from "./http.js";
import { base64Attachments, formatAddress, formatAddresses } from "./payloads.js";
import type { EmailAdapter } from "./types.js";
import { SUPPORTED_MESSAGE_FIELDS, assertSupportedMessageFields } from "./utils.js";

export type LoopsAdapterOptions = {
  apiKey: string;
  transactionalId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function loops(options: LoopsAdapterOptions): EmailAdapter<"loops", { baseUrl: string }> {
  if (!options.transactionalId) {
    throw new Error("loops requires a transactionalId.");
  }

  return jsonProvider({
    name: "loops",
    baseUrl: options.baseUrl ?? "https://app.loops.so",
    endpoint: "/api/v1/transactional",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    async buildPayload(message) {
      assertSupportedMessageFields("loops", message, SUPPORTED_MESSAGE_FIELDS.loops);
      const recipients = formatAddresses(message.to);
      const attachments = await base64Attachments(message);

      if (recipients.length !== 1) {
        throw new Error("loops only supports one recipient per transactional send.");
      }

      return {
        transactionalId: options.transactionalId,
        email: recipients[0],
        addToAudience: false,
        dataVariables: {
          subject: message.subject,
          html: message.html,
          text: message.text,
          from: formatAddress(message.from),
          ...message.metadata,
        },
        attachments: attachments?.map((attachment) => ({
          filename: attachment.filename,
          contentType: attachment.contentType ?? "application/octet-stream",
          data: attachment.content,
        })),
      };
    },
    fetch: options.fetch,
    parseResponse(body) {
      return {
        adapter: "loops",
        id: firstString(body as Record<string, unknown>, ["id", "transactionalId"]),
        raw: body,
      };
    },
  });
}
