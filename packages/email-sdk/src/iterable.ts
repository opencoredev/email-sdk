import { EmailValidationError } from "./errors.js";
import { jsonProvider } from "./http.js";
import { apiAddresses, formatAddress } from "./payloads.js";
import type { EmailMessage, EmailAdapter } from "./types.js";
import { SUPPORTED_MESSAGE_FIELDS, assertMaxItems, assertSupportedMessageFields } from "./utils.js";

export type IterableDataFields =
  | Record<string, unknown>
  | ((message: EmailMessage) => Record<string, unknown>);

export type IterableAdapterOptions = {
  apiKey: string;
  campaignId: number;
  allowRepeatMarketingSends?: boolean;
  dataFields?: IterableDataFields;
  sendAt?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function iterable(
  options: IterableAdapterOptions,
): EmailAdapter<"iterable", { baseUrl: string }> {
  if (!Number.isFinite(options.campaignId)) {
    throw new EmailValidationError("iterable requires a numeric campaignId.");
  }

  return jsonProvider({
    name: "iterable",
    baseUrl: options.baseUrl ?? "https://api.iterable.com",
    endpoint: "/api/email/target",
    headers: {
      "Api-Key": options.apiKey,
    },
    buildPayload(message) {
      assertSupportedMessageFields("iterable", message, SUPPORTED_MESSAGE_FIELDS.iterable);
      const recipients = apiAddresses(message.to);

      assertMaxItems("iterable", "recipient", recipients, 1);
      const recipient = recipients[0];

      if (!recipient) {
        throw new EmailValidationError("iterable requires one recipient.");
      }

      return {
        campaignId: options.campaignId,
        recipientEmail: recipient.email,
        allowRepeatMarketingSends: options.allowRepeatMarketingSends,
        sendAt: options.sendAt,
        dataFields: {
          ...resolveDataFields(options.dataFields, message),
          subject: message.subject,
          html: message.html,
          text: message.text,
          from: formatAddress(message.from),
        },
        metadata: message.metadata,
      };
    },
    fetch: options.fetch,
    parseResponse(body) {
      return {
        adapter: "iterable",
        raw: body,
      };
    },
  });
}

function resolveDataFields(dataFields: IterableDataFields | undefined, message: EmailMessage) {
  if (!dataFields) {
    return {};
  }

  return typeof dataFields === "function" ? dataFields(message) : dataFields;
}
