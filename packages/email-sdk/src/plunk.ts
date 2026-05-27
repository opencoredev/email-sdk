import { firstString, jsonProvider } from "./http.js";
import { formatAddress, formatAddresses } from "./payloads.js";
import type { EmailProvider } from "./types.js";
import { assertSupportedMessageFields } from "./utils.js";

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
    buildPayload(message) {
      assertSupportedMessageFields("plunk", message, {
        metadata: true,
      });

      return {
        to: formatAddresses(message.to),
        from: formatAddress(message.from),
        subject: message.subject,
        body: message.html ?? message.text,
        data: message.metadata,
      };
    },
    fetch: options.fetch,
    parseResponse(body) {
      return {
        provider: "plunk",
        id: firstString(body as Record<string, unknown>, ["id", "emailId"]),
        raw: body,
      };
    },
  });
}
