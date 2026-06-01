import { EmailProviderError, EmailValidationError } from "./errors.js";
import { jsonProvider } from "./http.js";
import { base64Attachments, commonHeadersObject, emailParts } from "./payloads.js";
import type { EmailAddress, EmailMessage, EmailProvider, OneOrMany } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  arrayify,
  assertMaxItems,
  assertSupportedMessageFields,
} from "./utils.js";

export type CloudflareProviderOptions = {
  apiToken: string;
  accountId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

type CloudflareSendResponse = {
  success?: boolean;
  errors?: Array<{ code?: number; message?: string }>;
  messages?: Array<{ code?: number; message?: string }>;
  result?: {
    delivered?: string[];
    permanent_bounces?: string[];
    queued?: string[];
  } | null;
};

export function cloudflare(
  options: CloudflareProviderOptions,
): EmailProvider<{ baseUrl: string; accountId: string }> {
  const baseUrl = options.baseUrl ?? "https://api.cloudflare.com/client/v4";

  return {
    ...jsonProvider<CloudflareSendResponse>({
      name: "cloudflare",
      baseUrl,
      endpoint: `/accounts/${encodeURIComponent(options.accountId)}/email/sending/send`,
      headers: {
        Authorization: `Bearer ${options.apiToken}`,
      },
      fetch: options.fetch,
      async buildPayload(message) {
        assertCloudflareMessage(message);

        const attachments = await base64Attachments(message);

        return {
          from: cloudflareAddress(message.from),
          to: cloudflareRecipients(message.to),
          cc: cloudflareOptionalRecipients(message.cc),
          bcc: cloudflareOptionalRecipients(message.bcc),
          reply_to: cloudflareOptionalReplyTo(message.replyTo),
          subject: message.subject,
          html: message.html,
          text: message.text,
          headers: commonHeadersObject(message),
          attachments: attachments?.map((attachment) => ({
            content: attachment.content,
            filename: attachment.filename,
            type: attachment.contentType ?? "application/octet-stream",
            disposition: attachment.disposition ?? "attachment",
            content_id: attachment.contentId,
          })),
        };
      },
      parseResponse(body) {
        if (body.success === false) {
          throw new EmailProviderError(cloudflareErrorMessage(body), {
            provider: "cloudflare",
            retryable: false,
            details: body,
          });
        }

        const result = body.result ?? {};
        const accepted = [...(result.delivered ?? []), ...(result.queued ?? [])];
        const rejected = result.permanent_bounces ?? [];

        return {
          provider: "cloudflare",
          accepted,
          rejected,
          raw: body,
        };
      },
    }),
    raw: { baseUrl, accountId: options.accountId },
  };
}

export function assertCloudflareMessage(message: EmailMessage) {
  assertSupportedMessageFields("cloudflare", message, SUPPORTED_MESSAGE_FIELDS.cloudflare);
  assertCloudflareLimits(message);
  cloudflareRecipients(message.to);
  cloudflareOptionalRecipients(message.cc);
  cloudflareOptionalRecipients(message.bcc);
  cloudflareOptionalReplyTo(message.replyTo);
}

function cloudflareAddress(address: EmailAddress) {
  const parts = emailParts(address);

  if (!parts.name) {
    return parts.email;
  }

  return {
    address: parts.email,
    name: parts.name,
  };
}

function cloudflareRecipients(addresses: OneOrMany<EmailAddress>) {
  return arrayify(addresses).map(cloudflareRecipient);
}

function cloudflareOptionalRecipients(addresses: OneOrMany<EmailAddress> | undefined) {
  const values = arrayify(addresses).map(cloudflareRecipient);
  return values.length > 0 ? values : undefined;
}

function cloudflareRecipient(address: EmailAddress) {
  const parts = emailParts(address);

  if (parts.name) {
    throw new EmailValidationError(
      "cloudflare recipient fields only support plain email addresses.",
      { adapter: "cloudflare", address: parts.email },
    );
  }

  return parts.email;
}

function cloudflareOptionalReplyTo(addresses: OneOrMany<EmailAddress> | undefined) {
  const values = arrayify(addresses);

  if (values.length === 0) {
    return undefined;
  }

  assertMaxItems("cloudflare", "replyTo", values, 1);
  return cloudflareAddress(values[0]!);
}

function assertCloudflareLimits(message: EmailMessage) {
  const recipients = [...arrayify(message.to), ...arrayify(message.cc), ...arrayify(message.bcc)];

  assertMaxItems("cloudflare", "recipient", recipients, 50);
}

function cloudflareErrorMessage(body: CloudflareSendResponse) {
  const message = body.errors
    ?.map((error) => error.message)
    .find((value): value is string => Boolean(value));

  return message ? `cloudflare failed: ${message}` : "cloudflare failed.";
}
