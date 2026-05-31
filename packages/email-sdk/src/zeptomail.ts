import { firstString, jsonProvider } from "./http.js";
import { base64Attachments, emailParts } from "./payloads.js";
import type { EmailAddress, EmailProvider, OneOrMany } from "./types.js";
import { SUPPORTED_MESSAGE_FIELDS, assertSupportedMessageFields } from "./utils.js";

export type ZeptoMailProviderOptions = {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function zeptomail(options: ZeptoMailProviderOptions): EmailProvider<{ baseUrl: string }> {
  return jsonProvider({
    name: "zeptomail",
    baseUrl: options.baseUrl ?? "https://api.zeptomail.com",
    endpoint: "/v1.1/email",
    headers: {
      Authorization: options.token.startsWith("Zoho-enczapikey ")
        ? options.token
        : `Zoho-enczapikey ${options.token}`,
    },
    fetch: options.fetch,
    async buildPayload(message) {
      assertSupportedMessageFields("zeptomail", message, SUPPORTED_MESSAGE_FIELDS.zeptomail);
      const attachments = await base64Attachments(message);

      return {
        from: zeptoAddress(message.from),
        to: zeptoRecipients(message.to),
        cc: zeptoOptionalRecipients(message.cc),
        bcc: zeptoOptionalRecipients(message.bcc),
        reply_to: zeptoOptionalRecipients(message.replyTo),
        subject: message.subject,
        htmlbody: message.html,
        textbody: message.text,
        attachments: attachments?.map((attachment) => ({
          name: attachment.filename,
          content: attachment.content,
          mime_type: attachment.contentType,
        })),
      };
    },
    parseResponse(body) {
      return {
        provider: "zeptomail",
        id: firstString(body as Record<string, unknown>, ["request_id", "messageId", "id"]),
        raw: body,
      };
    },
  });
}

function zeptoAddress(address: EmailAddress) {
  const parsed = emailParts(address);

  return {
    address: parsed.email,
    name: parsed.name,
  };
}

function zeptoRecipients(addresses: OneOrMany<EmailAddress>) {
  return (Array.isArray(addresses) ? addresses : [addresses]).map((address) => ({
    email_address: zeptoAddress(address),
  }));
}

function zeptoOptionalRecipients(addresses: OneOrMany<EmailAddress> | undefined) {
  return addresses ? zeptoRecipients(addresses) : undefined;
}
