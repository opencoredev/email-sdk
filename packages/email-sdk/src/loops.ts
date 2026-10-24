import { EmailValidationError } from "./errors.js";
import { firstString, jsonProvider } from "./http.js";
import { base64Attachments, formatAddress, formatAddresses } from "./payloads.js";
import type { EmailAdapter, EmailNativePassthrough } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertSupportedMessageFields,
  assertMaxItems,
  arrayify,
  type MessageRules,
} from "./utils.js";

export type LoopsAdapterOptions = {
  apiKey: string;
  transactionalId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

const loopsRules: MessageRules = (message) => {
  assertMaxItems("loops", "recipient", arrayify(message.to), 1);
};

/**
 * Experimental. Loops-only send options, passed as `native: { loops: { ... } }`.
 * https://loops.so/docs/api-reference/send-transactional-email
 */
export type LoopsNativeOptions = EmailNativePassthrough & {
  /** Overrides the adapter's `transactionalId` for this send. */
  transactionalId?: string;
  /** Merged over the data variables the adapter builds from the message. */
  dataVariables?: Readonly<Record<string, string | number>>;
  /** Create a contact when none matches the recipient. Defaults to `false`. */
  addToAudience?: boolean;
};

export function loops(
  options: LoopsAdapterOptions,
): EmailAdapter<"loops", { baseUrl: string }, unknown, LoopsNativeOptions> {
  if (!options.transactionalId) {
    throw new EmailValidationError("loops requires a transactionalId.");
  }

  return jsonProvider({
    name: "loops",
    rules: loopsRules,
    baseUrl: options.baseUrl ?? "https://app.loops.so",
    endpoint: "/api/v1/transactional",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    async buildPayload(message, native: LoopsNativeOptions | undefined) {
      assertSupportedMessageFields("loops", message, SUPPORTED_MESSAGE_FIELDS.loops);
      const recipients = formatAddresses(message.to);
      const attachments = await base64Attachments(message);

      if (recipients.length !== 1) {
        throw new EmailValidationError("loops only supports one recipient per transactional send.");
      }

      return {
        transactionalId: native?.transactionalId ?? options.transactionalId,
        email: recipients[0],
        addToAudience: native?.addToAudience ?? false,
        dataVariables: {
          subject: message.subject,
          html: message.html,
          text: message.text,
          from: formatAddress(message.from),
          ...message.metadata,
          ...native?.dataVariables,
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
        id: firstString(body, ["id", "transactionalId"]),
        raw: body,
      };
    },
  });
}
