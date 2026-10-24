import { EmailAdapterError, EmailValidationError } from "./errors.js";
import { jsonString, readJsonBody } from "./internal/decode.js";
import type { EmailAttachment, EmailMessage, EmailAdapter } from "./types.js";
import {
  builtInAdapterDefinition,
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
  arrayify,
  emailAddressOf,
  type MessageRules,
} from "./utils.js";

export type JetemailAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

const jetemailRules: MessageRules = (message) => {
  if (!formatAddress(message.from).includes("<")) {
    const from = emailAddressOf(message.from);
    throw new EmailValidationError(
      `jetemail requires a from address with a display name, for example "Acme <${from}>".`,
    );
  }

  assertMaxItems("jetemail", "recipient", arrayify(message.to), 50);
  assertMaxItems("jetemail", "cc", arrayify(message.cc), 50);
  assertMaxItems("jetemail", "bcc", arrayify(message.bcc), 50);
  assertMaxItems("jetemail", "replyTo", arrayify(message.replyTo), 50);
};

export function jetemail(
  options: JetemailAdapterOptions,
): EmailAdapter<"jetemail", { baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.jetemail.com";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "jetemail",
    ...builtInAdapterDefinition("jetemail", jetemailRules),
    raw: { baseUrl },
    async send(message, context) {
      // Read per send so a rotated apiKey or edited headers apply to the next request.
      const headers = new Headers({
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
        ...options.headers,
      });

      if (context.idempotencyKey) {
        headers.set("Idempotency-Key", context.idempotencyKey);
      }

      const response = await fetcher(`${baseUrl}/email`, {
        method: "POST",
        signal: context.signal,
        headers,
        body: JSON.stringify(await toJetemailPayload(message)),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailAdapterError(httpErrorMessage("JetEmail", response.status, body), {
          adapter: "jetemail",
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }

      const body = await readJsonBody(response);

      return {
        adapter: "jetemail",
        id: jsonString(body, "id"),
        raw: body,
      };
    },
  };
}

async function toJetemailPayload(message: EmailMessage) {
  assertSupportedMessageFields("jetemail", message, SUPPORTED_MESSAGE_FIELDS.jetemail);

  const from = formatAddress(message.from);

  // JetEmail rejects a bare email in `from`; it requires the `"Name <email>"` form.
  if (!from.includes("<")) {
    throw new EmailValidationError(
      `jetemail requires a from address with a display name, for example "Acme <${from}>".`,
      { adapter: "jetemail", field: "from" },
    );
  }

  const to = formatAddresses(message.to);
  const cc = formatAddresses(message.cc);
  const bcc = formatAddresses(message.bcc);
  const replyTo = formatAddresses(message.replyTo);

  // JetEmail caps each address field at 50 entries.
  assertMaxItems("jetemail", "recipient", to, 50);
  assertMaxItems("jetemail", "cc", cc, 50);
  assertMaxItems("jetemail", "bcc", bcc, 50);
  assertMaxItems("jetemail", "replyTo", replyTo, 50);

  const attachments = message.attachments?.length
    ? await Promise.all(message.attachments.map(toJetemailAttachment))
    : undefined;

  return {
    from,
    to,
    subject: message.subject,
    html: message.html,
    text: message.text,
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
    reply_to: replyTo.length > 0 ? replyTo : undefined,
    headers: headersToObject(message.headers),
    attachments,
  };
}

async function toJetemailAttachment(attachment: EmailAttachment) {
  return {
    filename: attachment.filename,
    data: await attachmentToBase64(attachment),
  };
}
