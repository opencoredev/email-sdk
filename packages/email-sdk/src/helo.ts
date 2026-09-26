import { EmailAdapterError } from "./errors.js";
import { isJsonObject, jsonArray, jsonField, jsonString, readJson } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
import type { EmailAttachment, EmailMessage, EmailAdapter } from "./types.js";
import { apiAddresses, emailParts, optionalApiAddresses } from "./payloads.js";
import {
  builtInAdapterDefinition,
  attachmentToBase64,
  headersToObject,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
  validateBuiltInAdapter,
} from "./utils.js";

export type HeloAdapterOptions = {
  apiKey: string;
  /**
   * Channel to send through. Required when the API credential is valid for every Channel;
   * omit it for a credential scoped to a single Channel.
   */
  channelId?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

// Helo rejects idempotency keys longer than 36 characters.
const MAX_IDEMPOTENCY_KEY_LENGTH = 36;

export function helo(options: HeloAdapterOptions): EmailAdapter<"helo", { baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.helohq.com";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "helo",
    ...builtInAdapterDefinition("helo"),
    raw: { baseUrl },
    async send(message, context) {
      validateBuiltInAdapter("helo", message);

      const headers = new Headers({
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      });

      if (options.channelId) {
        headers.set("X-Helo-Channel-Id", options.channelId);
      }

      // Set after construction so a per-send key replaces a static one in any casing.
      if (context.idempotencyKey) {
        headers.set("X-Helo-Idempotency-Key", await heloIdempotencyKey(context.idempotencyKey));
      }

      const response = await fetcher(`${baseUrl}/send/transactional`, {
        method: "POST",
        signal: context.signal,
        headers,
        body: JSON.stringify(await toHeloPayload(message)),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailAdapterError(heloErrorMessage(response.status, body), {
          adapter: "helo",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          delivery: heloDelivery(response.status),
        });
      }

      const body = await readJson(response);

      // Helo reports each send as accepted, delayed, or failed. A failed send carries an
      // errorCode and was never queued.
      if (jsonString(body, "status")?.toLowerCase() === "failed") {
        const code = jsonString(body, "errorCode");
        const detail = jsonString(body, "errorMessage") ?? "no reason given";

        throw new EmailAdapterError(
          `Helo failed the send: ${detail}${code ? ` (${code})` : ""}.`,
          { adapter: "helo", status: response.status, retryable: false, delivery: "not_sent" },
        );
      }

      const id = jsonString(body, "messageId");

      // Without a message id the response does not show whether Helo accepted the message.
      if (body === undefined || !id) {
        throw new EmailAdapterError(
          `Helo returned ${response.status} without a message id, so the outcome is unknown.`,
          { adapter: "helo", status: response.status, retryable: false, delivery: "unknown" },
        );
      }

      return {
        adapter: "helo",
        id,
        raw: body,
      };
    },
  };
}

async function toHeloPayload(message: EmailMessage) {
  const attachments = message.attachments?.length
    ? await Promise.all(message.attachments.map(toHeloAttachment))
    : undefined;

  return {
    from: emailParts(message.from),
    to: apiAddresses(message.to),
    cc: optionalApiAddresses(message.cc),
    bcc: optionalApiAddresses(message.bcc),
    replyTo: optionalApiAddresses(message.replyTo),
    subject: message.subject,
    html: message.html,
    text: message.text,
    attachments,
    // Helo tags are plain strings, so the tag value is sent and the name is dropped.
    tags: message.tags?.length ? message.tags.map((tag) => tag.value) : undefined,
    headers: headersToObject(message.headers),
    metadata: heloMetadata(message.metadata),
  };
}

async function toHeloAttachment(attachment: EmailAttachment) {
  const inline = attachment.disposition === "inline" || Boolean(attachment.contentId);

  return {
    content: await attachmentToBase64(attachment),
    fileName: attachment.filename,
    contentType: attachment.contentType,
    contentId: attachment.contentId,
    disposition: inline ? "inline" : "attachment",
  };
}

function heloMetadata(metadata: EmailMessage["metadata"]) {
  if (!metadata || Object.keys(metadata).length === 0) {
    return undefined;
  }

  // Helo metadata values must be strings, so coerce the normalized scalar values.
  return Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [key, value === null ? "" : String(value)]),
  );
}

// Personalized sends derive per-recipient keys by appending the address, which easily passes
// Helo's 36-character limit. Longer keys are hashed into a UUID-shaped SHA-256 digest so the
// same client key always maps to the same Helo key.
async function heloIdempotencyKey(key: string) {
  if (key.length <= MAX_IDEMPOTENCY_KEY_LENGTH) {
    return key;
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));

  const hex = [...new Uint8Array(digest).slice(0, 16)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// Helo validates and authorizes before queueing, so other 4xx responses were not sent. A 408
// timeout leaves the outcome unknown, and a 409 can mean the idempotency key belongs to an
// in-flight request whose outcome is unknown here.
function heloDelivery(status: number): "not_sent" | "unknown" {
  return status === 408 || status === 409 || status >= 500 ? "unknown" : "not_sent";
}

function heloErrorMessage(status: number, body: JsonValue | undefined) {
  // Helo errors are RFC 9457 problem details: `detail` is the human-readable text and `code`
  // is the stable Helo error code.
  const detail = jsonString(body, "detail") ?? jsonString(body, "title");
  const code = jsonString(body, "code");

  if (detail !== undefined) {
    const fields = fieldErrors(jsonField(body, "errors"));

    return `Helo failed with ${status}: ${detail}${fields ? ` ${fields}` : ""}${code ? ` (${code})` : ""}`;
  }

  return httpErrorMessage("Helo", status, body);
}

// Validation errors are keyed by JSON pointer, e.g. { "/to/0/email": [{ message, code }] }.
function fieldErrors(errors: JsonValue | undefined) {
  if (!isJsonObject(errors)) {
    return undefined;
  }

  const messages = Object.keys(errors).flatMap((field) =>
    jsonArray(errors, field).flatMap((entry) => {
      const text = jsonString(entry, "message");

      return text ? [`${field}: ${text}`] : [];
    }),
  );

  return messages.length > 0 ? messages.join("; ") : undefined;
}
