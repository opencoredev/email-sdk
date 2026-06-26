import { EmailProviderError } from "./errors.js";
import type { EmailAttachment, EmailMessage, EmailProvider } from "./types.js";
import {
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

export type LettermintProviderOptions = {
  apiToken: string;
  baseUrl?: string;
  /** Optional routing key (Lettermint route slug). Defaults to the project's default route. */
  route?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

type LettermintResponse = {
  message_id?: string;
  status?: string;
};

export function lettermint(options: LettermintProviderOptions): EmailProvider<{ baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.lettermint.co/v1";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "lettermint",
    raw: { baseUrl },
    async send(message, context) {
      const response = await fetcher(`${baseUrl}/send`, {
        method: "POST",
        signal: context.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "x-lettermint-token": options.apiToken,
          ...options.headers,
          // Spread after options.headers so a per-send idempotency key stays authoritative
          // and is never shadowed by a static Idempotency-Key passed at construction time.
          ...(context.idempotencyKey ? { "Idempotency-Key": context.idempotencyKey } : {}),
        },
        body: JSON.stringify(await toLettermintPayload(message, options.route)),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailProviderError(httpErrorMessage("Lettermint", response.status, body), {
          provider: "lettermint",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          details: body,
        });
      }

      const body = (await response.json().catch(() => ({}))) as LettermintResponse;

      return {
        provider: "lettermint",
        id: body.message_id,
        messageId: body.message_id,
        raw: body,
      };
    },
  };
}

async function toLettermintPayload(message: EmailMessage, route?: string) {
  assertSupportedMessageFields("lettermint", message, SUPPORTED_MESSAGE_FIELDS.lettermint);

  // Lettermint exposes a single freeform `tag` (alphanumeric, underscores, hyphens, spaces),
  // so the adapter fails fast rather than silently dropping extra tags, and forwards the tag
  // value to stay within Lettermint's tag charset (a "name:value" join would be rejected).
  assertMaxItems("lettermint", "tag", message.tags ?? [], 1);

  const cc = formatAddresses(message.cc);
  const bcc = formatAddresses(message.bcc);
  const replyTo = formatAddresses(message.replyTo);
  const attachments = message.attachments?.length
    ? await Promise.all(message.attachments.map(toLettermintAttachment))
    : undefined;

  return {
    route,
    from: formatAddress(message.from),
    to: formatAddresses(message.to),
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
    reply_to: replyTo.length > 0 ? replyTo : undefined,
    subject: message.subject,
    html: message.html,
    text: message.text,
    tag: message.tags?.[0]?.value,
    headers: headersToObject(message.headers),
    metadata: lettermintMetadata(message.metadata),
    attachments,
  };
}

async function toLettermintAttachment(attachment: EmailAttachment) {
  return {
    filename: attachment.filename,
    content: await attachmentToBase64(attachment),
    content_type: attachment.contentType,
    content_id: attachment.contentId,
  };
}

function lettermintMetadata(metadata: EmailMessage["metadata"]) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return undefined;
  }

  // Lettermint metadata values must be strings, so coerce the normalized scalar values.
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, value === null ? "" : String(value)]),
  );
}
