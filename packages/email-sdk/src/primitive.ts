import { EmailProviderError } from "./errors.js";
import type { EmailAttachment, EmailMessage, EmailProvider } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertMaxItems,
  assertSupportedMessageFields,
  attachmentToBase64,
  formatAddress,
  formatAddresses,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
} from "./utils.js";

export type PrimitiveProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

type PrimitiveResponse = {
  success?: boolean;
  data?: {
    id?: string;
    status?: string;
    accepted?: string[];
    rejected?: string[];
    queue_id?: string | null;
    request_id?: string;
  };
};

export function primitive(options: PrimitiveProviderOptions): EmailProvider<{ baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.primitive.dev/v1";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "primitive",
    raw: { baseUrl },
    async send(message, context) {
      const response = await fetcher(`${baseUrl}/send-mail`, {
        method: "POST",
        signal: context.signal,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          ...(context.idempotencyKey ? { "Idempotency-Key": context.idempotencyKey } : {}),
          ...options.headers,
        },
        body: JSON.stringify(await toPrimitivePayload(message)),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailProviderError(primitiveErrorMessage(response.status, body), {
          provider: "primitive",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          details: body,
        });
      }

      const body = (await response.json().catch(() => ({}))) as PrimitiveResponse;
      const data = body.data ?? {};

      return {
        provider: "primitive",
        id: data.id,
        messageId: data.id,
        accepted: data.accepted,
        rejected: data.rejected,
        raw: body,
      };
    },
  };
}

async function toPrimitivePayload(message: EmailMessage) {
  assertSupportedMessageFields("primitive", message, SUPPORTED_MESSAGE_FIELDS.primitive);

  const to = formatAddresses(message.to);

  // Primitive's send-mail accepts a single recipient and has no cc or bcc, so the
  // adapter fails fast rather than silently dropping extra recipients.
  assertMaxItems("primitive", "recipient", to, 1);

  const attachments = message.attachments?.length
    ? await Promise.all(message.attachments.map(toPrimitiveAttachment))
    : undefined;

  return {
    from: formatAddress(message.from),
    to: to[0],
    subject: message.subject,
    body_text: message.text,
    body_html: message.html,
    attachments,
  };
}

async function toPrimitiveAttachment(attachment: EmailAttachment) {
  return {
    filename: attachment.filename,
    content_base64: await attachmentToBase64(attachment),
    content_type: attachment.contentType,
  };
}

function primitiveErrorMessage(status: number, body: unknown) {
  if (body && typeof body === "object") {
    const error = (body as Record<string, unknown>).error;

    if (error && typeof error === "object") {
      const { code, message } = error as Record<string, unknown>;

      if (typeof message === "string") {
        return typeof code === "string"
          ? `Primitive failed with ${status}: ${message} (${code})`
          : `Primitive failed with ${status}: ${message}`;
      }
    }
  }

  return httpErrorMessage("Primitive", status, body);
}
