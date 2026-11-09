import { firstString, jsonProvider } from "./http.js";
import {
  apiAddress,
  apiAddresses,
  base64Attachments,
  commonHeadersObject,
  optionalApiAddresses,
  optionalSingleApiAddress,
  sendAtIso,
} from "./payloads.js";
import type { EmailAdapter, EmailNativeObject, EmailNativePassthrough } from "./types.js";
import {
  assertMaxItems,
  arrayify,
  type MessageRules,
} from "./utils.js";

export type BrevoAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

const brevoRules: MessageRules = (message) => {
  assertMaxItems("brevo", "replyTo", arrayify(message.replyTo), 1);
};

/**
 * Experimental. Brevo-only send options, passed as `native: { brevo: { ... } }`.
 * https://developers.brevo.com/reference/sendtransacemail
 */
export type BrevoNativeOptions = EmailNativePassthrough & {
  /**
   * Send a stored Brevo template. The template supplies the body, so the message's `html` and
   * `text` are not sent. The message subject is still sent and overrides the template's subject,
   * unless `useTemplateSubject` is set.
   */
  templateId?: number;
  /** With `templateId`, leave `message.subject` out so the template's own subject applies. */
  useTemplateSubject?: boolean;
  /** Template parameters, merged over the `params` built from `message.metadata`. */
  params?: EmailNativeObject;
  /** UUIDv4 batch identifier. */
  batchId?: string;
};

export function brevo(
  options: BrevoAdapterOptions,
): EmailAdapter<"brevo", { baseUrl: string }, unknown, BrevoNativeOptions> {
  return jsonProvider({
    name: "brevo",
    rules: brevoRules,
    baseUrl: options.baseUrl ?? "https://api.brevo.com",
    endpoint: "/v3/smtp/email",
    headers: {
      "api-key": options.apiKey,
    },
    fetch: options.fetch,
    async buildPayload(message, native: BrevoNativeOptions | undefined) {
      const attachments = await base64Attachments(message);

      const payload = {
        sender: apiAddress(message.from),
        to: apiAddresses(message.to),
        cc: optionalApiAddresses(message.cc),
        bcc: optionalApiAddresses(message.bcc),
        replyTo: optionalSingleApiAddress("brevo", "replyTo", message.replyTo),
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
        headers: commonHeadersObject(message),
        params: message.metadata,
        tags: message.tags?.map((tag) => tag.value),
        scheduledAt: sendAtIso(message),
        attachment: attachments?.map((attachment) => ({
          name: attachment.filename,
          content: attachment.content,
        })),
      };

      if (!native) return payload;

      const template = native.templateId !== undefined;

      return {
        ...payload,
        subject: template && native.useTemplateSubject ? undefined : payload.subject,
        htmlContent: template ? undefined : payload.htmlContent,
        textContent: template ? undefined : payload.textContent,
        templateId: native.templateId,
        params: native.params ? { ...payload.params, ...native.params } : payload.params,
        batchId: native.batchId,
      };
    },
    parseResponse(body) {
      return {
        adapter: "brevo",
        id: firstString(body, ["messageId", "id"]),
        messageId: firstString(body, ["messageId", "id"]),
        raw: body,
      };
    },
  });
}
