import { EmailAdapterError, EmailValidationError } from "./errors.js";
import type { EmailAttachment, EmailMessage, EmailAdapter } from "./types.js";
import {
  builtInAdapterDefinition,
  SUPPORTED_MESSAGE_FIELDS,
  assertMaxItems,
  assertSupportedMessageFields,
  attachmentToBase64,
  formatAddress,
  formatAddresses,
  headersToObject,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
} from "./utils.js";

export type JetemailAdapterOptions = {
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

export function jetemail(
  options: JetemailAdapterOptions,
): EmailAdapter<"jetemail", { baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.jetemail.com";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "jetemail",
    ...builtInAdapterDefinition("jetemail"),
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
        throw new EmailAdapterError(httpErrorMessage("JetEmail", response.status, body), {
          adapter: "jetemail",
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }

      const body = (await response.json().catch(() => ({}))) as JetemailResponse;

      return {
        adapter: "jetemail",
        id: body.id,
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

  const to = formatAddresses(message.to);
  const cc = formatAddresses(message.cc);
  const bcc = formatAddresses(message.bcc);
  const replyTo = formatAddresses(message.replyTo);

  // JetEmail caps each address field at 50 entries.
  assertMaxItems("jetemail", "recipient", to, 50);
  assertMaxItems("jetemail", "cc", cc, 50);
  assertMaxItems("jetemail", "bcc", bcc, 50);
  assertMaxItems("jetemail", "replyTo", replyTo, 50);

  const attachments = message.attachments?.length
    ? await Promise.all(message.attachments.map(toJetemailAttachment))
    : undefined;

  return {
    from,
    to,
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
