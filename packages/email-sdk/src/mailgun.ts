import { EmailAdapterError, EmailValidationError } from "./errors.js";
import { snapshotMessageForSend } from "./http.js";
import { utf8ToBase64 } from "./internal/bytes.js";
import { isNonArrayObject, jsonString } from "./internal/decode.js";
import { snapshotPersonalizedInputForSend } from "./internal/snapshot.js";
import { recipientVariablesMap, sendAtRfc2822 } from "./payloads.js";
import type { EmailAdapter, EmailMessage } from "./types.js";
import {
  emailAddressOf,
  builtInAdapterDefinition,
  arrayify,
  assertMaxItems,
  attachmentToBytes,
  formatAddress,
  formatAddresses,
  headersToArray,
  hasRecipientVariables,
  httpErrorDelivery,
  isRetryableStatus,
  readErrorBody,
  httpErrorMessage,
  validateBuiltInAdapter,
} from "./utils.js";

export type MailgunAdapterOptions = {
  apiKey: string;
  domain: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function mailgun(
  options: MailgunAdapterOptions,
): EmailAdapter<"mailgun", { baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.mailgun.net";

  const send: EmailAdapter<"mailgun">["send"] = async (rawMessage, context) => {
    const message = snapshotMessageForSend(rawMessage);
    validateBuiltInAdapter("mailgun", message);

    const body = new FormData();
    body.set("from", formatAddress(message.from));
    body.set("subject", message.subject);

    for (const to of formatAddresses(message.to)) body.append("to", to);

    for (const cc of formatAddresses(message.cc)) body.append("cc", cc);

    for (const bcc of formatAddresses(message.bcc)) body.append("bcc", bcc);

    for (const replyTo of formatAddresses(message.replyTo)) body.append("h:Reply-To", replyTo);

    for (const header of headersToArray(message.headers) ?? []) {
      body.append(`h:${header.name}`, header.value);
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
        Authorization: `Basic ${utf8ToBase64(`api:${options.apiKey}`)}`,
      },
      body,
    });

    const responseBody = await readErrorBody(response);

    if (!response.ok) {
      throw new EmailAdapterError(httpErrorMessage("mailgun", response.status, responseBody), {
        adapter: "mailgun",
        status: response.status,
        retryable: isRetryableStatus(response.status),
        delivery: httpErrorDelivery(response.status),
      });
    }

    const id = jsonString(responseBody, "id");

    return {
      adapter: "mailgun",
      id,
      raw: responseBody,
    };
  };

  return {
    name: "mailgun",
    ...builtInAdapterDefinition("mailgun"),
    raw: { baseUrl },
    send,
    async sendPersonalized(input, context) {
      const safeInput = snapshotPersonalizedInputForSend(input);

      if (
        !isNonArrayObject(safeInput) ||
        !isNonArrayObject(safeInput.message) ||
        !Array.isArray(safeInput.recipients)
      ) {
        throw new EmailValidationError("sendPersonalized input must include a message and recipients.");
      }

      const recipientVariables = Object.fromEntries(
        safeInput.recipients.map((recipient) => [
          emailAddressOf(recipient.to),
          recipient.variables,
        ]),
      );

      const result = await send(
        // SAFETY: safeInput.message is a snapshotted EmailMessage without its recipient fields,
        // and `to` restores them. recipientVariables is the legacy extension read by the Mailgun form builder.
        {
          ...safeInput.message,
          to: safeInput.recipients.map((recipient) => recipient.to),
          recipientVariables,
        } as EmailMessage,
        context,
      );

      return {
        ...result,
        accepted: safeInput.recipients.map((recipient) => emailAddressOf(recipient.to)),
        rejected: [],
      };
    },
  };
}


