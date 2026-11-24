import { EmailValidationError } from "./errors.js";
import { firstString, jsonProvider } from "./http.js";
import { isString } from "./internal/decode.js";
import { base64Attachments, emailParts } from "./payloads.js";
import type { EmailAddress, EmailAdapter, OneOrMany } from "./types.js";
import { SUPPORTED_MESSAGE_FIELDS, assertSupportedMessageFields } from "./utils.js";

export type ZeptoMailAdapterOptions = {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function zeptomail(
  options: ZeptoMailAdapterOptions,
): EmailAdapter<"zeptomail", { baseUrl: string }> {
  // Fail at construction for a bad token, then read it again on every send so rotation works.
  zeptoAuthorization(options.token);

  return jsonProvider({
    name: "zeptomail",
    baseUrl: options.baseUrl ?? "https://api.zeptomail.com",
    endpoint: "/v1.1/email",
    headers: () => ({ Authorization: zeptoAuthorization(options.token) }),
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
        adapter: "zeptomail",
        id: firstString(body, ["request_id", "messageId", "id"]),
        raw: body,
      };
    },
  });
}

const TOKEN_PREFIX = "Zoho-enczapikey ";

// The token is typed as a string, but untyped callers can pass anything (an
// un-awaited secret loader's Promise, a number), and calling startsWith on that
// threw a bare TypeError. Check it at runtime and name the bad option instead.
function zeptoAuthorization(token: string) {
  if (!isString(token) || token === "") {
    throw new EmailValidationError("zeptomail token must be a non-empty string.");
  }

  return token.startsWith(TOKEN_PREFIX) ? token : `${TOKEN_PREFIX}${token}`;
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
