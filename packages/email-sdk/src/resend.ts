import { EmailAdapterError } from "./errors.js";
import { jsonString, responseJson } from "./internal/decode.js";
import { sendAtIso } from "./payloads.js";
import type {
  EmailAttachment,
  EmailMessage,
  EmailAdapter,
  EmailNativePassthrough,
} from "./types.js";
import {
  builtInAdapterDefinition,
  attachmentToBase64,
  formatAddress,
  formatAddresses,
  headersToObject,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
  assertSupportedMessageFields,
  SUPPORTED_MESSAGE_FIELDS,
  mapAttachments,
  IDEMPOTENCY_HEADERS,
  withNativeRequestHeaders,
} from "./utils.js";

export type ResendAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

/**
 * Experimental. Resend-only send options, passed as `native: { resend: { ... } }`.
 * https://resend.com/docs/api-reference/emails/send-email
 */
export type ResendNativeOptions = EmailNativePassthrough & {
  /**
   * Send a published Resend template. Resend rejects `html` and `text` alongside a template, so
   * the adapter drops them. The message subject is still sent and overrides the template's
   * default subject, unless `useTemplateSubject` is set.
   */
  template?: {
    /** Template ID or alias. */
    id: string;
    variables?: Readonly<Record<string, string | number>>;
    /** Leave `message.subject` out so the template's own default subject applies. */
    useTemplateSubject?: boolean;
  };
  /** Subscription topic the recipient must be opted in to (`topic_id`). */
  topicId?: string;
};

export function resend(
  options: ResendAdapterOptions,
): EmailAdapter<"resend", { baseUrl: string }, unknown, ResendNativeOptions> {
  const baseUrl = options.baseUrl ?? "https://api.resend.com";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "resend",
    ...builtInAdapterDefinition("resend"),
    raw: { baseUrl },
    async send(message, context) {
      const native = context.native;
      const payload = await toResendPayload(message);

      // Read per send so a rotated apiKey or edited headers apply to the next request.
      const headers = new Headers({
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      });

      if (context.idempotencyKey) {
        headers.set("Idempotency-Key", context.idempotencyKey);
      }

      const response = await fetcher(`${baseUrl}/emails`, {
        method: "POST",
        signal: context.signal,
        headers: native?.headers ? withNativeRequestHeaders("resend", headers, native.headers, IDEMPOTENCY_HEADERS) : headers,
        body: JSON.stringify(native ? withResendNative(payload, native) : payload),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailAdapterError(httpErrorMessage("Resend", response.status, body), {
          adapter: "resend",
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }

      const body = await responseJson(response);

      return {
        adapter: "resend",
        id: jsonString(body, "id"),
        raw: body,
      };
    },
  };
}

async function toResendPayload(message: EmailMessage) {
  assertSupportedMessageFields("resend", message, SUPPORTED_MESSAGE_FIELDS.resend);

  return {
    from: formatAddress(message.from),
    to: formatAddresses(message.to),
    subject: message.subject,
    html: message.html,
    text: message.text,
    cc: formatAddresses(message.cc),
    bcc: formatAddresses(message.bcc),
    reply_to: formatAddresses(message.replyTo),
    headers: headersToObject(message.headers),
    attachments: await mapAttachments(message.attachments, toResendAttachment),
    tags: message.tags,
    scheduled_at: sendAtIso(message),
  };
}

type ResendPayload = Awaited<ReturnType<typeof toResendPayload>>;

function withResendNative(payload: ResendPayload, native: ResendNativeOptions) {
  const template = native.template && {
    id: native.template.id,
    variables: native.template.variables,
  };

  const withNative = {
    ...payload,
    ...(template && { html: undefined, text: undefined, template }),
    ...(native.template?.useTemplateSubject && { subject: undefined }),
    topic_id: native.topicId,
  };

  return native.body ? { ...withNative, ...native.body } : withNative;
}

async function toResendAttachment(attachment: EmailAttachment) {
  return {
    filename: attachment.filename,
    content: await attachmentToBase64(attachment),
    content_type: attachment.contentType,
    content_id: attachment.contentId,
  };
}
