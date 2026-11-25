import { EmailAbortError, EmailAdapterError, EmailValidationError } from "./errors.js";
import { snapshotMessageForSend } from "./http.js";
import { isJsonBoolean, jsonField, jsonString, readJson } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
import type { EmailAdapter, EmailAttachment, EmailMessage } from "./types.js";
import { emailParts, sendAtIso } from "./payloads.js";
import {
  builtInAdapterDefinition,
  allRecipients,
  arrayify,
  assertMaxItems,
  attachmentToBase64,
  emailAddressOf,
  hasDisplayName,
  headerList,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
  toProviderError,
  validateBuiltInAdapter,
  type MessageRules,
} from "./utils.js";

export type NightmailAdapterOptions = {
  apiKey: string;
  /** Defaults to hosted Nightmail. Self-hosted installations pass their own public URL. */
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

// Nightmail accepts idempotency keys of up to 200 printable ASCII characters.
const IDEMPOTENCY_KEY = /^[\x21-\x7e]{1,200}$/;

const nightmailRules: MessageRules = (message) => {
  const replyTo = arrayify(message.replyTo);

  assertMaxItems("nightmail", "to recipient", arrayify(message.to), 50);
  assertMaxItems("nightmail", "cc recipient", arrayify(message.cc), 49);
  assertMaxItems("nightmail", "bcc recipient", arrayify(message.bcc), 49);
  assertMaxItems("nightmail", "replyTo address", replyTo, 10);
  assertMaxItems("nightmail", "header", headerList(message.headers), 15);
  assertMaxItems("nightmail", "attachment", message.attachments ?? [], 100);

  // Nightmail takes the sender display name as fromName and bare addresses everywhere else.
  if ([...allRecipients(message), ...replyTo].some(hasDisplayName)) {
    throw new EmailValidationError(
      "nightmail recipient and replyTo fields only support plain email addresses.",
    );
  }
};

type NightmailRequestBody =
  | ReturnType<typeof toNightmailPayload>
  | Awaited<ReturnType<typeof toNightmailUpload>>;

type NightmailRequest = (
  path: string,
  body: NightmailRequestBody,
  idempotencyKey: string | undefined,
) => Promise<Response>;

export function nightmail(
  options: NightmailAdapterOptions,
): EmailAdapter<"nightmail", { baseUrl: string }> {
  const baseUrl = (options.baseUrl ?? "https://nightmail.dev").replace(/\/$/, "");
  const fetcher = options.fetch ?? fetch;

  return {
    name: "nightmail",
    ...builtInAdapterDefinition("nightmail", nightmailRules),
    raw: { baseUrl },
    async send(rawMessage, context) {
      const message = snapshotMessageForSend(rawMessage);
      validateBuiltInAdapter("nightmail", message, nightmailRules);

      // A per-send key wins over a static Idempotency-Key header. Either way each request gets
      // its own key below, so the uploads never share the send's key or one another's.
      const clientKey =
        context.idempotencyKey ?? new Headers(options.headers).get("Idempotency-Key") ?? undefined;

      const key = clientKey ? await nightmailIdempotencyKey(clientKey) : undefined;

      const request: NightmailRequest = (path, body, idempotencyKey) => {
        // Read per request so a rotated apiKey or edited headers apply to the next send.
        const headers = new Headers({
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
          ...options.headers,
        });

        // Set after construction so the resolved key replaces a static one in any casing.
        if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
        else headers.delete("Idempotency-Key");

        return fetcher(`${baseUrl}${path}`, {
          method: "POST",
          signal: context.signal,
          headers,
          body: JSON.stringify(body),
        });
      };

      const attachments = await uploadAttachments(message.attachments ?? [], key, request).catch(
        (cause: unknown) => {
          // Cancellation is the caller's to see, so an abort is never relabelled as a refusal.
          if (cause instanceof EmailAbortError || (cause instanceof Error && cause.name === "AbortError")) {
            throw cause;
          }

          const error = toProviderError("nightmail", cause);

          // The email was never submitted, so a failed upload or attachment read cannot have sent it.
          if (!(error instanceof EmailAdapterError) || error.delivery === "not_sent") throw error;

          throw new EmailAdapterError(error.message, {
            adapter: "nightmail",
            status: error.status,
            retryable: error.retryable,
            delivery: "not_sent",
            cause,
          });
        },
      );

      const response = await request("/v1/emails/send", toNightmailPayload(message, attachments), key);

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailAdapterError(nightmailErrorMessage(response.status, body), {
          adapter: "nightmail",
          status: response.status,
          retryable: nightmailRetryable(response.status, body),
          delivery: nightmailDelivery(response.status),
        });
      }

      const body = await readJson(response);
      const id = jsonString(body, "id");

      // Nightmail answers a queued send with 202 and status "queued". Anything else does not show
      // what Nightmail accepted.
      if (response.status !== 202 || jsonString(body, "status") !== "queued" || !id) {
        throw new EmailAdapterError(
          `Nightmail returned ${response.status} without a queued email id, so the outcome is unknown.`,
          { adapter: "nightmail", status: response.status, retryable: false, delivery: "unknown" },
        );
      }

      return {
        adapter: "nightmail",
        id,
        raw: body,
      };
    },
  };
}

// Nightmail's send takes attachment IDs, so each file is uploaded first. With an idempotency key,
// each upload gets a key derived from it, so a retried send reuses the same attachment IDs and
// its body matches the first attempt instead of failing with IDEMPOTENCY_CONFLICT.
async function uploadAttachments(
  attachments: readonly EmailAttachment[],
  key: string | undefined,
  request: NightmailRequest,
): Promise<string[]> {
  const ids: string[] = [];

  for (const [index, attachment] of attachments.entries()) {
    const uploadKey = key ? `att-${await sha256Hex(`${key}\n${index}`)}` : undefined;
    const response = await request("/v1/attachments", await toNightmailUpload(attachment), uploadKey);

    // The email itself was never submitted, so a failed upload cannot have sent anything.
    if (!response.ok) {
      const body = await readErrorBody(response);
      throw new EmailAdapterError(
        `${nightmailErrorMessage(response.status, body)} while uploading attachment ${attachment.filename}`,
        {
          adapter: "nightmail",
          status: response.status,
          retryable: nightmailRetryable(response.status, body),
          delivery: "not_sent",
        },
      );
    }

    const id = jsonString(await readJson(response), "id");

    if (!id) {
      throw new EmailAdapterError(
        `Nightmail returned ${response.status} without an attachment id for ${attachment.filename}.`,
        { adapter: "nightmail", status: response.status, retryable: false, delivery: "not_sent" },
      );
    }

    ids.push(id);
  }

  return ids;
}

async function toNightmailUpload(attachment: EmailAttachment) {
  const inline = attachment.disposition === "inline" || Boolean(attachment.contentId);

  return {
    filename: attachment.filename,
    content: await attachmentToBase64(attachment),
    contentType: attachment.contentType,
    disposition: inline ? "inline" : "attachment",
    contentId: attachment.contentId,
  };
}

function optionalAddresses(value: EmailMessage["cc"]) {
  const list = arrayify(value).map(emailAddressOf);

  return list.length > 0 ? list : undefined;
}

function toNightmailPayload(message: EmailMessage, attachments: readonly string[]) {
  const from = emailParts(message.from);
  const headers = headerList(message.headers);

  return {
    from: from.email,
    fromName: from.name,
    to: arrayify(message.to).map(emailAddressOf),
    cc: optionalAddresses(message.cc),
    bcc: optionalAddresses(message.bcc),
    replyTo: optionalAddresses(message.replyTo),
    subject: message.subject,
    // Nightmail rejects empty html and text strings, so an empty body part is left out.
    html: message.html || undefined,
    text: message.text || undefined,
    attachments: attachments.length > 0 ? attachments : undefined,
    headers: headers.length > 0 ? headers.map(({ name, value }) => ({ name, value })) : undefined,
    scheduledAt: sendAtIso(message),
  };
}

// Personalized sends derive per-recipient keys by appending the address, which can pass
// Nightmail's 200-character limit. Those keys are hashed, so the same client key always maps
// to the same Nightmail key.
async function nightmailIdempotencyKey(key: string) {
  return IDEMPOTENCY_KEY.test(key) ? key : `sdk-${await sha256Hex(key)}`;
}

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));

  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

// Nightmail checks validation, suppression, balance, limits, and content screening before it
// queues, and refuses a 429 (rate, ramp, or built-in domain limit) with nothing queued. A 408,
// a 409 (an idempotent request still in flight, or a key reused with another body), and 5xx
// leave the outcome unknown.
function nightmailDelivery(status: number): "not_sent" | "unknown" {
  return status === 408 || status === 409 || status >= 500 || status < 400 ? "unknown" : "not_sent";
}

// Nightmail's error body says whether a retry can succeed, so it wins over the status code.
function nightmailRetryable(status: number, body: JsonValue | undefined) {
  const retryable = jsonField(jsonField(body, "error"), "retryable");

  return isJsonBoolean(retryable) ? retryable : isRetryableStatus(status);
}

function nightmailErrorMessage(status: number, body: JsonValue | undefined) {
  const error = jsonField(body, "error");
  const message = jsonString(error, "message");

  if (message === undefined) return httpErrorMessage("Nightmail", status, body);

  const code = jsonString(error, "code");
  const requestId = jsonString(error, "requestId");
  const details = [code, requestId ? `request ${requestId}` : undefined].filter(Boolean).join(", ");

  return `Nightmail failed with ${status}: ${message}${details ? ` (${details})` : ""}`;
}
