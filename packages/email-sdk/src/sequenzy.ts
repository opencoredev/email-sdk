import { EmailProviderError } from "./errors.js";
import { firstString, jsonProvider } from "./http.js";
import { formatAddress, formatAddresses } from "./payloads.js";
import type { EmailAttachment, EmailMessage, EmailProvider } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertMaxItems,
  assertSupportedMessageFields,
  attachmentToBase64,
} from "./utils.js";

export type SequenzyProviderOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

type SequenzyResponse = {
  success?: boolean;
  error?: string;
  jobId?: string;
  to?: string | string[];
  transactional?: {
    id?: string;
    slug?: string;
    name?: string;
  };
};

const reservedMetadataKeys = new Set([
  "sequenzySlug",
  "sequenzyPreview",
  "subscriberExternalId",
  "sequenzySubscriberExternalId",
]);

export function sequenzy(options: SequenzyProviderOptions): EmailProvider<{ baseUrl: string }> {
  return jsonProvider<SequenzyResponse>({
    name: "sequenzy",
    baseUrl: options.baseUrl ?? "https://api.sequenzy.com/api/v1",
    endpoint: "/transactional/send",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
    },
    fetch: options.fetch,
    async buildPayload(message) {
      assertSupportedMessageFields("sequenzy", message, SUPPORTED_MESSAGE_FIELDS.sequenzy);
      assertMaxItems("sequenzy", "recipient", formatAddresses(message.to), 50);
      assertMaxItems("sequenzy", "replyTo", formatAddresses(message.replyTo), 1);

      const slug = stringMetadata(message, "sequenzySlug");
      const preview = stringMetadata(message, "sequenzyPreview");
      const subscriberExternalId =
        stringMetadata(message, "subscriberExternalId") ??
        stringMetadata(message, "sequenzySubscriberExternalId");
      const variables = sequenzyVariables(message.metadata);

      return {
        to: toSequenzyRecipients(message),
        slug,
        subject: slug ? undefined : message.subject,
        body: slug ? undefined : (message.html ?? message.text),
        preview,
        variables,
        subscriberExternalId,
        from: formatAddress(message.from),
        replyTo: formatAddresses(message.replyTo)[0],
        attachments: message.attachments?.length
          ? await Promise.all(message.attachments.map(toSequenzyAttachment))
          : undefined,
      };
    },
    parseResponse(body) {
      if (body.success === false) {
        throw new EmailProviderError(`Sequenzy failed: ${body.error ?? "Unknown error"}`, {
          provider: "sequenzy",
          retryable: false,
          details: body,
        });
      }

      return {
        provider: "sequenzy",
        id: firstString(body as Record<string, unknown>, ["jobId", "id"]),
        messageId: firstString(body as Record<string, unknown>, ["jobId", "id"]),
        accepted: Array.isArray(body.to) ? body.to : body.to ? [body.to] : undefined,
        raw: body,
      };
    },
  });
}

function toSequenzyRecipients(message: EmailMessage) {
  const recipients = formatAddresses(message.to);
  return recipients.length === 1 ? recipients[0] : recipients;
}

function stringMetadata(message: EmailMessage, key: string) {
  const value = message.metadata?.[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function sequenzyVariables(metadata: EmailMessage["metadata"]) {
  if (!metadata) {
    return undefined;
  }

  const entries = Object.entries(metadata).filter(([key]) => !reservedMetadataKeys.has(key));
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

async function toSequenzyAttachment(attachment: EmailAttachment) {
  if (attachment.path && /^https?:\/\//i.test(attachment.path)) {
    return {
      filename: attachment.filename,
      path: attachment.path,
    };
  }

  return {
    filename: attachment.filename,
    content: await attachmentToBase64(attachment),
  };
}
