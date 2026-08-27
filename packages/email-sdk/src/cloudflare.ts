import { EmailAdapterError, EmailValidationError } from "./errors.js";
import { jsonProvider } from "./http.js";
import { base64Attachments, commonHeadersObject, emailParts, stringAddresses } from "./payloads.js";
import type { EmailAddress, EmailAdapter, EmailMessage, OneOrMany } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  arrayify,
  assertMaxItems,
  assertSupportedMessageFields,
  builtInAdapterDefinition,
} from "./utils.js";

export type CloudflareSendEmailAddress =
  | string
  | {
      email: string;
      name?: string;
    };

export type CloudflareSendEmailAttachment = {
  content: string;
  filename: string;
  type: string;
  disposition: "attachment" | "inline";
  contentId?: string;
};

export type CloudflareSendEmailMessage = {
  from: CloudflareSendEmailAddress;
  to: CloudflareSendEmailAddress | readonly CloudflareSendEmailAddress[];
  subject: string;
  html?: string;
  text?: string;
  cc?: CloudflareSendEmailAddress | readonly CloudflareSendEmailAddress[];
  bcc?: CloudflareSendEmailAddress | readonly CloudflareSendEmailAddress[];
  replyTo?: CloudflareSendEmailAddress;
  attachments?: readonly CloudflareSendEmailAttachment[];
  headers?: Record<string, string>;
};

export type CloudflareSendEmailResult = {
  messageId: string;
};

export type CloudflareSendEmailBinding = {
  send(message: CloudflareSendEmailMessage): Promise<CloudflareSendEmailResult>;
};

export type CloudflareHttpAdapterOptions = {
  apiToken: string;
  accountId: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  binding?: never;
};

export type CloudflareBindingAdapterOptions = {
  binding: CloudflareSendEmailBinding;
  apiToken?: never;
  accountId?: never;
  baseUrl?: never;
  fetch?: never;
};

export type CloudflareAdapterOptions =
  | CloudflareHttpAdapterOptions
  | CloudflareBindingAdapterOptions;

export type CloudflareAdapterRaw =
  | { baseUrl: string; accountId: string }
  | { binding: CloudflareSendEmailBinding };

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
  options: CloudflareAdapterOptions,
): EmailAdapter<"cloudflare", CloudflareAdapterRaw> {
  if ("binding" in options && options.binding) {
    return fromBinding(options.binding);
  }

  return fromHttp(options);
}

function fromBinding(
  binding: CloudflareSendEmailBinding,
): EmailAdapter<"cloudflare", { binding: CloudflareSendEmailBinding }> {
  return {
    name: "cloudflare",
    ...builtInAdapterDefinition("cloudflare"),
    raw: { binding },
    async send(message) {
      assertCloudflareMessage(message);

      const attachments = await base64Attachments(message);

      const payload: CloudflareSendEmailMessage = {
        from: cloudflareBindingAddress(message.from),
        to: cloudflareRecipients(message.to),
        cc: cloudflareOptionalRecipients(message.cc),
        bcc: cloudflareOptionalRecipients(message.bcc),
        replyTo: cloudflareOptionalBindingReplyTo(message.replyTo),
        subject: message.subject,
        html: message.html,
        text: message.text,
        headers: commonHeadersObject(message),
        attachments: attachments?.map((attachment) => ({
          content: attachment.content!,
          filename: attachment.filename,
          type: attachment.contentType ?? "application/octet-stream",
          disposition: attachment.disposition ?? "attachment",
          contentId: attachment.contentId,
        })),
      };

      try {
        const result = await binding.send(payload);

        const accepted = [
          ...stringAddresses(message.to),
          ...(message.cc ? stringAddresses(message.cc) : []),
          ...(message.bcc ? stringAddresses(message.bcc) : []),
        ];

        return {
          adapter: "cloudflare",
          id: result.messageId,
          accepted,
          raw: result ?? undefined,
        };
      } catch (error) {
        if (error instanceof EmailAdapterError || error instanceof EmailValidationError) {
          throw error;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new EmailAdapterError(`cloudflare failed: ${errorMessage}`, {
          adapter: "cloudflare",
          cause: error,
          retryable: false,
        });
      }
    },
  };
}

function fromHttp(
  options: CloudflareHttpAdapterOptions,
): EmailAdapter<"cloudflare", { baseUrl: string; accountId: string }> {
  const baseUrl = options.baseUrl ?? "https://api.cloudflare.com/client/v4";

  return {
    ...jsonProvider<"cloudflare", CloudflareSendResponse>({
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
        if (body.success !== true) {
          throw new EmailAdapterError(cloudflareErrorMessage(body), {
            adapter: "cloudflare",
            retryable: false,
          });
        }

        const result = body.result ?? {};
        const accepted = [...(result.delivered ?? []), ...(result.queued ?? [])];
        const rejected = result.permanent_bounces ?? [];

        return {
          adapter: "cloudflare",
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

function cloudflareBindingAddress(address: EmailAddress): CloudflareSendEmailAddress {
  const parts = emailParts(address);

  if (!parts.name) {
    return parts.email;
  }

  return {
    email: parts.email,
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

function cloudflareOptionalBindingReplyTo(
  addresses: OneOrMany<EmailAddress> | undefined,
) {
  const values = arrayify(addresses);

  if (values.length === 0) {
    return undefined;
  }

  assertMaxItems("cloudflare", "replyTo", values, 1);
  return cloudflareBindingAddress(values[0]!);
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
