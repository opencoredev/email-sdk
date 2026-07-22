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
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
} from "./utils.js";

export type PrimitiveAdapterOptions = {
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

export function primitive(
  options: PrimitiveAdapterOptions,
): EmailAdapter<"primitive", { baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.primitive.dev/v1";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "primitive",
    ...builtInAdapterDefinition("primitive"),
    raw: { baseUrl },
    async send(message, context) {
      const response = await fetcher(`${baseUrl}/send-mail`, {
        method: "POST",
        signal: context.signal,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          ...options.headers,
          // Spread after options.headers so a per-send idempotency key stays authoritative
          // and is never shadowed by a static Idempotency-Key passed at construction time.
          ...(context.idempotencyKey ? { "Idempotency-Key": context.idempotencyKey } : {}),
        },
        body: JSON.stringify(await toPrimitivePayload(message)),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailAdapterError(primitiveErrorMessage(response.status, body), {
          adapter: "primitive",
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }

      const body = (await response.json().catch(() => ({}))) as PrimitiveResponse;
      const data = body.data ?? {};

      return {
        adapter: "primitive",
        id: data.id,
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

  // Primitive's send-mail accepts exactly one recipient and has no cc or bcc, so
  // the adapter fails fast rather than silently dropping or omitting recipients.
  assertMaxItems("primitive", "recipient", to, 1);

  const recipient = to[0];

  if (!recipient) {
    throw new EmailValidationError("primitive requires one recipient.", {
      adapter: "primitive",
      field: "to",
    });
  }

  const attachments = message.attachments?.length
    ? await Promise.all(message.attachments.map(toPrimitiveAttachment))
    : undefined;

  return {
    from: formatAddress(message.from),
    to: recipient,
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
