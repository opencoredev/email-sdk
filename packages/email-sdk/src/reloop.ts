import { EmailAdapterError } from "./errors.js";
import { jsonString, readJson } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
import { sendAtIso } from "./payloads.js";
import type { EmailAttachment, EmailMessage, EmailAdapter } from "./types.js";
import {
  builtInAdapterDefinition,
  attachmentToBase64,
  formatAddress,
  formatAddresses,
  headersToObject,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
  validateBuiltInAdapter,
} from "./utils.js";

export type ReloopAdapterOptions = {
  apiKey: string;
  /** Defaults to Reloop Cloud. Set it to your own Reloop domain when self-hosting. */
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

// Reloop truncates idempotency keys to 500 characters, so two longer keys that share a prefix
// would replay each other's send.
const MAX_IDEMPOTENCY_KEY_LENGTH = 500;

export function reloop(options: ReloopAdapterOptions): EmailAdapter<"reloop", { baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://reloop.sh";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "reloop",
    ...builtInAdapterDefinition("reloop"),
    raw: { baseUrl },
    async send(message, context) {
      validateBuiltInAdapter("reloop", message);

      const headers = new Headers({
        "x-api-key": options.apiKey,
        "Content-Type": "application/json",
        ...options.headers,
      });

      // Set after construction so a per-send key replaces a static one in any casing.
      if (context.idempotencyKey) {
        headers.set("Idempotency-Key", await reloopIdempotencyKey(context.idempotencyKey));
      }

      const response = await fetcher(`${baseUrl}/api/mail/v1/send`, {
        method: "POST",
        signal: context.signal,
        headers,
        body: JSON.stringify(await toReloopPayload(message)),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailAdapterError(reloopErrorMessage(response.status, body), {
          adapter: "reloop",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          delivery: reloopDelivery(response.status),
        });
      }

      const body = await readJson(response);
      const id = jsonString(body, "id");

      // Without an email id the response does not show whether Reloop accepted the message.
      if (body === undefined || !id) {
        throw new EmailAdapterError(
          `Reloop returned ${response.status} without an email id, so the outcome is unknown.`,
          { adapter: "reloop", status: response.status, retryable: false, delivery: "unknown" },
        );
      }

      return {
        adapter: "reloop",
        id,
        raw: body,
      };
    },
  };
}

async function toReloopPayload(message: EmailMessage) {
  const attachments = message.attachments?.length
    ? await Promise.all(message.attachments.map(toReloopAttachment))
    : undefined;

  return {
    from: formatAddress(message.from),
    to: formatAddresses(message.to),
    cc: message.cc ? formatAddresses(message.cc) : undefined,
    bcc: message.bcc ? formatAddresses(message.bcc) : undefined,
    reply_to: message.replyTo ? formatAddresses(message.replyTo) : undefined,
    subject: message.subject,
    html: message.html,
    text: message.text,
    headers: headersToObject(message.headers),
    attachments,
    tags: message.tags?.length ? message.tags : undefined,
    scheduled_at: sendAtIso(message),
  };
}

async function toReloopAttachment(attachment: EmailAttachment) {
  // Reloop decodes string attachment content as base64.
  return {
    content: await attachmentToBase64(attachment),
    filename: attachment.filename,
    content_type: attachment.contentType,
    content_id: attachment.contentId,
  };
}

// Longer keys are replaced by their SHA-256 hex digest so the same client key always maps to
// the same Reloop key.
async function reloopIdempotencyKey(key: string) {
  if (key.length <= MAX_IDEMPOTENCY_KEY_LENGTH) {
    return key;
  }

  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Reloop validates, authorizes, checks quota and rate limits, and drops suppressed recipients
// before it queues anything, so 4xx responses were not sent. A 408 timeout leaves the outcome
// unknown, a 409 can come from a concurrent request with the same idempotency key, and a 5xx can
// follow a successful handoff to the MTA.
function reloopDelivery(status: number): "not_sent" | "unknown" {
  return status === 408 || status === 409 || status >= 500 ? "unknown" : "not_sent";
}

function reloopErrorMessage(status: number, body: JsonValue | undefined) {
  // Reloop errors carry a short `message`, the cause in `why`, and a remedy in `fix`.
  const message = jsonString(body, "message");
  const why = jsonString(body, "why");
  const fix = jsonString(body, "fix");

  if (message !== undefined && (why !== undefined || fix !== undefined)) {
    const details = [why, fix].filter((part) => part !== undefined).join(" ");

    return `Reloop failed with ${status}: ${message}. ${details}`;
  }

  return httpErrorMessage("Reloop", status, body);
}
