import { EmailAdapterError } from "./errors.js";
import { jsonString, readJson } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
import { sendAtIso } from "./payloads.js";
import type { EmailAttachment, EmailMessage, EmailAdapter } from "./types.js";
import {
  builtInAdapterDefinition,
  attachmentToBase64,
  emailAddressOf,
  formatAddress,
  headersToObject,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
  validateBuiltInAdapter,
  arrayify,
} from "./utils.js";

export type EusendAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

// eusend stores at most 255 characters of an idempotency key and drops the rest, so two long
// keys sharing a prefix would collide.
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;

export function eusend(options: EusendAdapterOptions): EmailAdapter<"eusend", { baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.eusend.dev";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "eusend",
    ...builtInAdapterDefinition("eusend"),
    raw: { baseUrl },
    async send(message, context) {
      validateBuiltInAdapter("eusend", message);

      const headers = new Headers({
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      });

      // Set after construction so a per-send key replaces a static one in any casing.
      if (context.idempotencyKey) {
        headers.set("Idempotency-Key", await eusendIdempotencyKey(context.idempotencyKey));
      }

      const response = await fetcher(`${baseUrl}/emails`, {
        method: "POST",
        signal: context.signal,
        headers,
        body: JSON.stringify(await toEusendPayload(message)),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailAdapterError(eusendErrorMessage(response.status, body), {
          adapter: "eusend",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          delivery: eusendDelivery(response.status),
        });
      }

      const body = await readJson(response);
      const id = jsonString(body, "id");

      // A new send answers 201 and a replayed idempotency key answers 200, both with the id.
      // Without one the response does not show whether eusend accepted the message.
      if (body === undefined || !id) {
        throw new EmailAdapterError(
          `eusend returned ${response.status} without an email id, so the outcome is unknown.`,
          { adapter: "eusend", status: response.status, retryable: false, delivery: "unknown" },
        );
      }

      return {
        adapter: "eusend",
        id,
        raw: body,
      };
    },
  };
}

async function toEusendPayload(message: EmailMessage) {
  const attachments = message.attachments?.length
    ? await Promise.all(message.attachments.map(toEusendAttachment))
    : undefined;

  return {
    from: formatAddress(message.from),
    // Recipient fields take plain addresses; validation has already refused display names.
    to: plainAddresses(message.to),
    cc: optionalPlainAddresses(message.cc),
    bcc: optionalPlainAddresses(message.bcc),
    reply_to: optionalPlainAddresses(message.replyTo),
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: headersToObject(message.headers),
    attachments,
    tags: message.tags?.length ? message.tags : undefined,
    scheduled_at: sendAtIso(message),
  };
}

function plainAddresses(addresses: EmailMessage["to"] | EmailMessage["cc"]) {
  return arrayify(addresses).map(emailAddressOf);
}

function optionalPlainAddresses(addresses: EmailMessage["cc"]) {
  const plain = plainAddresses(addresses);

  return plain.length > 0 ? plain : undefined;
}

async function toEusendAttachment(attachment: EmailAttachment) {
  return {
    filename: attachment.filename,
    content: await attachmentToBase64(attachment),
    content_type: attachment.contentType,
    content_id: attachment.contentId,
  };
}

// Long keys are hashed into a SHA-256 hex digest so the same client key always maps to the
// same eusend key and distinct keys never collide on the stored prefix.
async function eusendIdempotencyKey(key: string) {
  if (key.length <= MAX_IDEMPOTENCY_KEY_LENGTH) {
    return key;
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// eusend validates, authorizes and checks quota and suppressions before it queues anything,
// so a 4xx was not sent. A 408 timeout or a 5xx leaves the outcome unknown.
function eusendDelivery(status: number): "not_sent" | "unknown" {
  return status === 408 || status >= 500 ? "unknown" : "not_sent";
}

function eusendErrorMessage(status: number, body: JsonValue | undefined) {
  // eusend errors are `{ error, code }`: `error` is the human-readable text and `code` the
  // stable error code, e.g. DOMAIN_NOT_VERIFIED or ALL_SUPPRESSED.
  const detail = jsonString(body, "error");
  const code = jsonString(body, "code");

  if (detail !== undefined) {
    return `eusend failed with ${status}: ${detail}${code ? ` (${code})` : ""}`;
  }

  return httpErrorMessage("eusend", status, body);
}
