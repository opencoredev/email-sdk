import { EmailAdapterError } from "./errors.js";
import { jsonString } from "./internal/decode.js";
import { recipientVariablesMap, sendAtRfc2822 } from "./payloads.js";
import type { EmailAdapter, EmailMessage, EmailNativeObject } from "./types.js";
import {
  emailAddressOf,
  builtInAdapterDefinition,
  arrayify,
  assertMaxItems,
  attachmentToBytes,
  formatAddress,
  formatAddresses,
  headersToArray,
  hasRecipientVariables,
  isRetryableStatus,
  readErrorBody,
  httpErrorMessage,
} from "./utils.js";

export type MailgunAdapterOptions = {
  apiKey: string;
  domain: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

/**
 * Experimental. Mailgun-only send options, passed as `native: { mailgun: { ... } }`.
 * Mailgun takes multipart form fields, so the escape hatch is `fields`, not a JSON `body`.
 * https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages
 */
export type MailgunNativeOptions = {
  /**
   * Send a stored Mailgun template. The template supplies the body, so the message's `html` and
   * `text` are not sent. Mailgun still uses the message subject.
   */
  template?: {
    name: string;
    /** `t:version` */
    version?: string;
    /** `t:variables`, JSON-encoded. */
    variables?: EmailNativeObject;
    /** `t:text=yes`: also render a text/plain part from the template. */
    renderText?: boolean;
  };
  /** `o:tracking` */
  tracking?: boolean | "htmlonly";
  /** `o:tracking-clicks` */
  trackingClicks?: boolean | "htmlonly";
  /** `o:tracking-opens` */
  trackingOpens?: boolean;
  /** `o:testmode`: Mailgun accepts the message but does not deliver it. */
  testMode?: boolean;
  /** `o:require-tls` */
  requireTls?: boolean;
  /** `o:skip-verification` */
  skipVerification?: boolean;
  /** `o:sending-ip-pool` */
  ipPool?: string;
  /** Extra form fields, set after the SDK's. An array appends one field per value. */
  fields?: Readonly<Record<string, string | readonly string[]>>;
  /** Extra HTTP request headers for the provider API call. These are not email headers. */
  headers?: Readonly<Record<string, string>>;
};

export function mailgun(
  options: MailgunAdapterOptions,
): EmailAdapter<"mailgun", { baseUrl: string }, unknown, MailgunNativeOptions> {
  const baseUrl = options.baseUrl ?? "https://api.mailgun.net";

  const send: EmailAdapter<"mailgun", unknown, unknown, MailgunNativeOptions>["send"] = async (
    message,
    context,
  ) => {
    const native = context.native;
    const body = new FormData();
    body.set("from", formatAddress(message.from));
    body.set("subject", message.subject);

    for (const to of formatAddresses(message.to)) body.append("to", to);

    for (const cc of formatAddresses(message.cc)) body.append("cc", cc);

    for (const bcc of formatAddresses(message.bcc)) body.append("bcc", bcc);

    for (const replyTo of formatAddresses(message.replyTo)) body.append("h:Reply-To", replyTo);

    for (const header of headersToArray(message.headers) ?? []) {
      body.append(`h:${header.name}`, header.value);
    }

    if (message.text && !native?.template) body.set("text", message.text);

    if (message.html && !native?.template) body.set("html", message.html);

    // Mailgun batch sending: %recipient.key% tokens in the body are substituted per
    // recipient, and recipient-variables tells Mailgun to send an individual email to
    // each address (≤1000 per call) instead of one shared message.
    if (hasRecipientVariables(message)) {
      assertMaxItems("mailgun", "recipient", arrayify(message.to), 1000);
      body.set("recipient-variables", JSON.stringify(recipientVariablesMap(message)));
    }

    for (const [name, value] of Object.entries(message.metadata ?? {})) {
      body.set(`v:${name}`, String(value));
    }

    for (const tag of message.tags ?? []) {
      body.append("o:tag", tag.value);
    }

    const deliveryTime = sendAtRfc2822(message);

    if (deliveryTime) body.set("o:deliverytime", deliveryTime);

    for (const attachment of message.attachments ?? []) {
      const bytes = await attachmentToBytes(attachment);

      const blob = new Blob([bytes], {
        type: attachment.contentType ?? "application/octet-stream",
      });

      body.append(
        attachment.disposition === "inline" ? "inline" : "attachment",
        blob,
        attachment.filename,
      );
    }

    if (native) applyMailgunNative(body, native);

    const fetcher = options.fetch ?? fetch;

    const response = await fetcher(`${baseUrl}/v3/${options.domain}/messages`, {
      method: "POST",
      signal: context.signal,
      headers: {
        ...native?.headers,
        Authorization: `Basic ${Buffer.from(`api:${options.apiKey}`).toString("base64")}`,
      },
      body,
    });

    const responseBody = await readErrorBody(response);

    if (!response.ok) {
      throw new EmailAdapterError(httpErrorMessage("mailgun", response.status, responseBody), {
        adapter: "mailgun",
        status: response.status,
        retryable: isRetryableStatus(response.status),
      });
    }

    const id = jsonString(responseBody, "id");

    return {
      adapter: "mailgun",
      id,
      raw: responseBody,
    };
  };

  return {
    name: "mailgun",
    ...builtInAdapterDefinition("mailgun"),
    raw: { baseUrl },
    send,
    async sendPersonalized(input, context) {
      const recipientVariables = Object.fromEntries(
        input.recipients.map((recipient) => [emailAddressOf(recipient.to), recipient.variables]),
      );

      const result = await send(
        // SAFETY: input.message is an EmailMessage without its recipient fields, and `to` restores
        // them. recipientVariables is the legacy extension read by the Mailgun form builder.
        {
          ...input.message,
          to: input.recipients.map((recipient) => recipient.to),
          recipientVariables,
        } as EmailMessage,
        context,
      );

      return {
        ...result,
        accepted: input.recipients.map((recipient) => emailAddressOf(recipient.to)),
        rejected: [],
      };
    },
  };
}



function applyMailgunNative(body: FormData, native: MailgunNativeOptions) {
  const template = native.template;

  if (template) {
    body.set("template", template.name);

    if (template.version !== undefined) body.set("t:version", template.version);

    if (template.variables) body.set("t:variables", JSON.stringify(template.variables));

    if (template.renderText) body.set("t:text", "yes");
  }

  setYesNo(body, "o:tracking", native.tracking);
  setYesNo(body, "o:tracking-clicks", native.trackingClicks);
  setYesNo(body, "o:tracking-opens", native.trackingOpens);
  setYesNo(body, "o:testmode", native.testMode);
  setYesNo(body, "o:require-tls", native.requireTls);
  setYesNo(body, "o:skip-verification", native.skipVerification);

  if (native.ipPool !== undefined) body.set("o:sending-ip-pool", native.ipPool);

  for (const [name, value] of Object.entries(native.fields ?? {})) {
    body.delete(name);

    for (const item of arrayify(value)) body.append(name, item);
  }
}

function setYesNo(body: FormData, field: string, value: boolean | "htmlonly" | undefined) {
  if (value === undefined) return;

  body.set(field, value === "htmlonly" ? value : value ? "yes" : "no");
}
