import { firstString, jsonProvider } from "./http.js";
import { formatAddress, formatAddresses, optionalStringAddresses } from "./payloads.js";
import type { EmailProvider } from "./types.js";
import { assertSupportedMessageFields } from "./utils.js";

export type MailPaceProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function mailpace(options: MailPaceProviderOptions): EmailProvider<{ baseUrl: string }> {
  return jsonProvider({
    name: "mailpace",
    baseUrl: options.baseUrl ?? "https://app.mailpace.com/api/v1",
    endpoint: "/send",
    headers: {
      "MailPace-Server-Token": options.apiKey,
    },
    buildPayload(message) {
      assertSupportedMessageFields("mailpace", message, {
        cc: true,
        bcc: true,
        replyTo: true,
      });

      return {
        from: formatAddress(message.from),
        to: formatAddresses(message.to).join(","),
        cc: optionalStringAddresses(message.cc)?.join(","),
        bcc: optionalStringAddresses(message.bcc)?.join(","),
        replyto: optionalStringAddresses(message.replyTo)?.join(","),
        subject: message.subject,
        htmlbody: message.html,
        textbody: message.text,
      };
    },
    fetch: options.fetch,
    parseResponse(body) {
      return {
        provider: "mailpace",
        id: firstString(body as Record<string, unknown>, ["id", "message_id"]),
        raw: body,
      };
    },
  });
}
