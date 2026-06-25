import { EmailProviderError, EmailValidationError } from "./errors.js";
import type { EmailAttachment, EmailMessage, EmailProvider } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertSupportedMessageFields,
  attachmentToBase64,
  formatAddress,
  formatAddresses,
  headersToObject,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
} from "./utils.js";

export type JetemailProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

type JetemailResponse = {
  id?: string;
  response?: string;
  scheduled_at?: number;
};

export function jetemail(options: JetemailProviderOptions): EmailProvider<{ baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.jetemail.com";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "jetemail",
    raw: { baseUrl },
    async send(message, context) {
      const response = await fetcher(`${baseUrl}/email`, {
        method: "POST",
        signal: context.signal,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          ...(context.idempotencyKey ? { "Idempotency-Key": context.idempotencyKey } : {}),
          ...options.headers,
        },
        body: JSON.stringify(await toJetemailPayload(message)),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailProviderError(httpErrorMessage("JetEmail", response.status, body), {
          provider: "jetemail",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          details: body,
        });
      }

      const body = (await response.json().catch(() => ({}))) as JetemailResponse;

      return {
        provider: "jetemail",
        id: body.id,
        messageId: body.id,
        raw: body,
      };
    },
  };
}

async function toJetemailPayload(message: EmailMessage) {
  assertSupportedMessageFields("jetemail", message, SUPPORTED_MESSAGE_FIELDS.jetemail);

  const from = formatAddress(message.from);

  // JetEmail rejects a bare email in `from`; it requires the `"Name <email>"` form.
  if (!from.includes("<")) {
    throw new EmailValidationError(
      `jetemail requires a from address with a display name, for example "Acme <${from}>".`,
      { adapter: "jetemail", field: "from" },
    );
  }

  const cc = formatAddresses(message.cc);
  const bcc = formatAddresses(message.bcc);
  const replyTo = formatAddresses(message.replyTo);
  const attachments = message.attachments?.length
    ? await Promise.all(message.attachments.map(toJetemailAttachment))
    : undefined;

  return {
    from,
    to: formatAddresses(message.to),
    subject: message.subject,
    html: message.html,
    text: message.text,
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
    reply_to: replyTo.length > 0 ? replyTo : undefined,
    headers: headersToObject(message.headers),
    attachments,
  };
}

async function toJetemailAttachment(attachment: EmailAttachment) {
  return {
    filename: attachment.filename,
    data: await attachmentToBase64(attachment),
  };
}
