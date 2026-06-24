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
  /** Wait for the first downstream SMTP delivery outcome before resolving. */
  wait?: boolean;
  /** Max time to wait for a delivery outcome when `wait` is true (1000-30000 ms). */
  waitTimeoutMs?: number;
};

type PrimitiveSendResult = {
  id?: string;
  status?: string;
  from?: string;
  queue_id?: string | null;
  accepted?: string[];
  rejected?: string[];
  request_id?: string;
  delivery_status?: string;
};

type PrimitiveResponse = {
  success?: boolean;
  data?: PrimitiveSendResult;
  error?: {
    code?: string;
    message?: string;
  };
};

export function primitive(options: PrimitiveProviderOptions): EmailProvider<{ baseUrl: string }> {
  const baseUrl = (options.baseUrl ?? "https://api.primitive.dev/v1").replace(/\/$/, "");
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
        body: JSON.stringify(await toPrimitivePayload(message, options)),
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

      if (body.success === false) {
        throw new EmailProviderError(primitiveErrorMessage(response.status, body), {
          provider: "primitive",
          retryable: false,
          details: body,
        });
      }

      const data = body.data ?? {};

      return {
        provider: "primitive",
        id: data.id,
        messageId: data.queue_id ?? data.id,
        accepted: data.accepted,
        rejected: data.rejected,
        raw: body,
      };
    },
  };
}

export function assertPrimitiveMessage(message: EmailMessage) {
  assertSupportedMessageFields("primitive", message, SUPPORTED_MESSAGE_FIELDS.primitive);
  assertMaxItems("primitive", "recipient", formatAddresses(message.to), 1);
}

async function toPrimitivePayload(message: EmailMessage, options: PrimitiveProviderOptions) {
  assertPrimitiveMessage(message);

  return {
    from: formatAddress(message.from),
    to: formatAddresses(message.to)[0],
    subject: message.subject,
    body_text: message.text,
    body_html: message.html,
    attachments: message.attachments?.length
      ? await Promise.all(message.attachments.map(toPrimitiveAttachment))
      : undefined,
    wait: options.wait,
    wait_timeout_ms: options.waitTimeoutMs,
  };
}

async function toPrimitiveAttachment(attachment: EmailAttachment) {
  return {
    filename: attachment.filename,
    content_type: attachment.contentType,
    content_base64: await attachmentToBase64(attachment),
  };
}

function primitiveErrorMessage(status: number, body: unknown): string {
  if (body && typeof body === "object") {
    const error = (body as PrimitiveResponse).error;

    if (error?.message) {
      return `primitive failed with ${status}: ${error.message}`;
    }
  }

  return httpErrorMessage("primitive", status, body);
}
