import { EmailAdapterError } from "./errors.js";
import { jsonString, readJson } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
import type { EmailAttachment, EmailMessage, EmailAdapter } from "./types.js";
import { emailParts, sendAtIso } from "./payloads.js";
import {
  arrayify,
  builtInAdapterDefinition,
  attachmentToBase64,
  emailAddressOf,
  headersToObject,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
  validateBuiltInAdapter,
} from "./utils.js";

export type SendheronAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

export function sendheron(
  options: SendheronAdapterOptions,
): EmailAdapter<"sendheron", { baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.sendheron.com/api/v1";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "sendheron",
    ...builtInAdapterDefinition("sendheron"),
    raw: { baseUrl },
    async send(message, context) {
      validateBuiltInAdapter("sendheron", message);

      const headers = new Headers({
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      });

      // Set after construction so a per-send key replaces a static one in any casing.
      if (context.idempotencyKey) {
        headers.set("idempotency-key", context.idempotencyKey);
      }

      const response = await fetcher(`${baseUrl}/emails/send`, {
        method: "POST",
        signal: context.signal,
        headers,
        body: JSON.stringify(await toSendheronPayload(message)),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailAdapterError(sendheronErrorMessage(response.status, body), {
          adapter: "sendheron",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          delivery: sendheronDelivery(response.status),
        });
      }

      const body = await readJson(response);
      const id = jsonString(body, "id");

      // A 201 is an outcome, not proof of dispatch: a compliance refusal comes back as
      // status "suppressed" with the reason in errorMessage, and must never be retried.
      if (jsonString(body, "status")?.toLowerCase() === "suppressed") {
        throw new EmailAdapterError(
          `SendHeron suppressed the send: ${jsonString(body, "errorMessage") ?? "no reason given"}.`,
          { adapter: "sendheron", retryable: false, delivery: "not_sent" },
        );
      }

      // Without a send id the response does not show whether SendHeron accepted the message.
      if (body === undefined || !id) {
        throw new EmailAdapterError(
          `SendHeron returned ${response.status} without a send id, so the outcome is unknown.`,
          { adapter: "sendheron", status: response.status, retryable: false, delivery: "unknown" },
        );
      }

      return {
        adapter: "sendheron",
        id,
        raw: body,
      };
    },
  };
}

async function toSendheronPayload(message: EmailMessage) {
  // SendHeron takes the sender address and display name as separate fields, and plain
  // addresses everywhere else (validation rejects recipient display names).
  const from = emailParts(message.from);
  const cc = arrayify(message.cc).map(emailAddressOf);
  const bcc = arrayify(message.bcc).map(emailAddressOf);
  const replyTo = arrayify(message.replyTo).map(emailAddressOf)[0];

  const attachments = message.attachments?.length
    ? await Promise.all(message.attachments.map(toSendheronAttachment))
    : undefined;

  return {
    to: arrayify(message.to).map(emailAddressOf)[0],
    subject: message.subject,
    // SendHeron has no plain-text field and requires html, so a text-only message is
    // escaped into a preformatted block instead of being refused.
    html: message.html ?? textToHtml(message.text ?? ""),
    from: from.email,
    fromName: from.name,
    replyTo,
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
    headers: headersToObject(message.headers),
    sendAt: sendAtIso(message),
    attachments,
  };
}

async function toSendheronAttachment(attachment: EmailAttachment) {
  return {
    content: await attachmentToBase64(attachment),
    filename: attachment.filename,
    type: attachment.contentType,
  };
}

function textToHtml(text: string) {
  const escaped = text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  return `<pre style="white-space:pre-wrap;font-family:inherit">${escaped}</pre>`;
}

// SendHeron records a 503 as a provider refusal and rejects other 4xx before sending. A 409
// means the idempotency key already belongs to another request, whose outcome is unknown here.
function sendheronDelivery(status: number): "not_sent" | "unknown" {
  if (status === 409) return "unknown";

  return status < 500 || status === 503 ? "not_sent" : "unknown";
}

function sendheronErrorMessage(status: number, body: JsonValue | undefined) {
  // `message` is SendHeron's stable error key; `description` is the human-readable text.
  const message = jsonString(body, "message");
  const description = jsonString(body, "description");

  if (message !== undefined && description !== undefined) {
    return `SendHeron failed with ${status}: ${description} (${message})`;
  }

  return httpErrorMessage("SendHeron", status, body);
}
