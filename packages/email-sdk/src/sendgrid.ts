import { firstString, jsonProvider } from "./http.js";
import {
  apiAddress,
  apiAddresses,
  commonHeadersObject,
  optionalApiAddresses,
  recipientVariableEntries,
  sendgridAttachments,
} from "./payloads.js";
import type { EmailMessage, EmailProvider } from "./types.js";
import { arrayify, assertMaxItems, hasRecipientVariables } from "./utils.js";

export type SendGridProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function sendgrid(options: SendGridProviderOptions): EmailProvider<{ baseUrl: string }> {
  const provider = jsonProvider({
    name: "sendgrid",
    baseUrl: options.baseUrl ?? "https://api.sendgrid.com",
    endpoint: "/v3/mail/send",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    fetch: options.fetch,
    async buildPayload(message) {
      return {
        personalizations: sendgridPersonalizations(message),
        from: apiAddress(message.from),
        reply_to_list: optionalApiAddresses(message.replyTo),
        subject: message.subject,
        content: [
          ...(message.text ? [{ type: "text/plain", value: message.text }] : []),
          ...(message.html ? [{ type: "text/html", value: message.html }] : []),
        ],
        attachments: await sendgridAttachments(message),
        categories: message.tags?.map((tag) => tag.value),
      };
    },
    parseResponse(body, _message, response) {
      return {
        provider: "sendgrid",
        id:
          firstString(body as Record<string, unknown>, ["id", "message_id"]) ??
          response.headers.get("x-message-id") ??
          undefined,
        raw: body,
      };
    },
  });

  return { ...provider, sendBulk: provider.send };
}

// With recipientVariables, emit one personalization per recipient so SendGrid substitutes
// each recipient's %recipient.key% tokens in a single API call; otherwise one shared personalization.
function sendgridPersonalizations(message: EmailMessage) {
  if (hasRecipientVariables(message)) {
    // SendGrid caps personalizations at 1000 per request; fail fast like Mailgun does.
    assertMaxItems("sendgrid", "recipient", arrayify(message.to), 1000);

    return recipientVariableEntries(message).map((entry) => ({
      to: [apiAddress(entry.to)],
      headers: commonHeadersObject(message),
      custom_args: message.metadata,
      substitutions: recipientSubstitutions(entry.variables),
    }));
  }

  return [
    {
      to: apiAddresses(message.to),
      cc: optionalApiAddresses(message.cc),
      bcc: optionalApiAddresses(message.bcc),
      headers: commonHeadersObject(message),
      custom_args: message.metadata,
    },
  ];
}

function recipientSubstitutions(variables: Record<string, string | number | boolean>) {
  const substitutions: Record<string, string> = {};

  for (const [key, value] of Object.entries(variables)) {
    substitutions[`%recipient.${key}%`] = String(value);
  }

  return substitutions;
}
