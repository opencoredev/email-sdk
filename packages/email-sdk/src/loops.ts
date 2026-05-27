import { firstString, jsonProvider } from "./http.js";
import { formatAddress, formatAddresses } from "./payloads.js";
import type { EmailProvider } from "./types.js";
import { assertSupportedMessageFields } from "./utils.js";

export type LoopsProviderOptions = {
  apiKey: string;
  transactionalId?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function loops(options: LoopsProviderOptions): EmailProvider<{ baseUrl: string }> {
  return jsonProvider({
    name: "loops",
    baseUrl: options.baseUrl ?? "https://app.loops.so",
    endpoint: "/api/v1/transactional",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    buildPayload(message) {
      assertSupportedMessageFields("loops", message, {
        metadata: true,
      });
      const recipients = formatAddresses(message.to);

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
      };
    },
    fetch: options.fetch,
    parseResponse(body) {
      return {
        provider: "loops",
        id: firstString(body as Record<string, unknown>, ["id", "transactionalId"]),
        raw: body,
      };
    },
  });
}
