import { EmailProviderError } from "./errors.js";
import { recipientVariablesMap, sendAtRfc2822 } from "./payloads.js";
import type { EmailProvider } from "./types.js";
import {
  arrayify,
  assertMaxItems,
  attachmentToBytes,
  formatAddress,
  formatAddresses,
  hasRecipientVariables,
  isRetryableStatus,
  readErrorBody,
  httpErrorMessage,
} from "./utils.js";

export type MailgunProviderOptions = {
  apiKey: string;
  domain: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function mailgun(options: MailgunProviderOptions): EmailProvider<{ baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.mailgun.net";

  const send: EmailProvider["send"] = async (message, context) => {
    const body = new FormData();
    body.set("from", formatAddress(message.from));
    body.set("subject", message.subject);

    for (const to of formatAddresses(message.to)) body.append("to", to);
    for (const cc of formatAddresses(message.cc)) body.append("cc", cc);
    for (const bcc of formatAddresses(message.bcc)) body.append("bcc", bcc);
    for (const replyTo of formatAddresses(message.replyTo)) body.append("h:Reply-To", replyTo);
    for (const [name, value] of Object.entries(message.headers ?? {})) {
      if (Array.isArray(message.headers)) {
        break;
      }

      body.append(`h:${name}`, value);
    }

    if (Array.isArray(message.headers)) {
      for (const header of message.headers) {
        body.append(`h:${header.name}`, header.value);
      }
    }

    if (message.text) body.set("text", message.text);
    if (message.html) body.set("html", message.html);

    // Mailgun batch sending: %recipient.key% tokens in the body are substituted per
    // recipient, and recipient-variables tells Mailgun to send an individual email to
    // each address (≤1000 per call) instead of one shared message.
    if (hasRecipientVariables(message)) {
      assertMaxItems("mailgun", "recipient", arrayify(message.to), 1000);
      body.set("recipient-variables", JSON.stringify(recipientVariablesMap(message)));
    }

    for (const [name, value] of Object.entries(message.metadata ?? {})) {
      body.set(`v:${name}`, String(value));
    }

    for (const tag of message.tags ?? []) {
      body.append("o:tag", tag.value);
    }

    const deliveryTime = sendAtRfc2822(message);
    if (deliveryTime) body.set("o:deliverytime", deliveryTime);

    for (const attachment of message.attachments ?? []) {
      const bytes = await attachmentToBytes(attachment);
      const blob = new Blob([bytes], {
        type: attachment.contentType ?? "application/octet-stream",
      });
      body.append(
        attachment.disposition === "inline" ? "inline" : "attachment",
        blob,
        attachment.filename,
      );
    }

    const fetcher = options.fetch ?? fetch;
    const response = await fetcher(`${baseUrl}/v3/${options.domain}/messages`, {
      method: "POST",
      signal: context.signal,
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${options.apiKey}`).toString("base64")}`,
      },
      body,
    });

    const responseBody = await readErrorBody(response);

    if (!response.ok) {
      throw new EmailProviderError(httpErrorMessage("mailgun", response.status, responseBody), {
        provider: "mailgun",
        status: response.status,
        retryable: isRetryableStatus(response.status),
        details: responseBody,
      });
    }

    const record = responseBody as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id : undefined;

    return {
      provider: "mailgun",
      id,
      messageId: id,
      raw: responseBody,
    };
  };

  return {
    name: "mailgun",
    raw: { baseUrl },
    send,
    sendBulk: send,
  };
}
