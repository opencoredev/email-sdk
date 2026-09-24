import { EmailAdapterError } from "./errors.js";
import { firstString, jsonProvider } from "./http.js";
import { isJsonString, isStringMember, jsonField } from "./internal/decode.js";
import type { JsonValue } from "./internal/decode.js";
import { formatAddress, formatAddresses } from "./payloads.js";
import type { EmailAttachment, EmailMessage, EmailAdapter } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertMaxItems,
  assertSupportedMessageFields,
  attachmentToBase64,
} from "./utils.js";

export type SequenzyAdapterOptions = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

const reservedMetadataKeys = new Set([
  "sequenzySlug",
  "sequenzyPreview",
  "subscriberExternalId",
  "sequenzySubscriberExternalId",
]);

export function sequenzy(
  options: SequenzyAdapterOptions,
): EmailAdapter<"sequenzy", { baseUrl: string }> {
  return jsonProvider({
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
      const error = jsonField(body, "error");

      if (jsonField(body, "success") === false || error) {
        throw new EmailAdapterError(`Sequenzy failed: ${error ?? "Unknown error"}`, {
          adapter: "sequenzy",
          retryable: false,
        });
      }

      return {
        adapter: "sequenzy",
        id: firstString(body, ["jobId", "id"]),
        messageId: firstString(body, ["jobId", "id"]),
        accepted: acceptedRecipients(jsonField(body, "to")),
        raw: body,
      };
    },
  });
}

function acceptedRecipients(to: JsonValue | undefined) {
  if (Array.isArray(to)) {
    return to.filter(isJsonString);
  }

  return isJsonString(to) && to ? [to] : undefined;
}

function toSequenzyRecipients(message: EmailMessage) {
  const recipients = formatAddresses(message.to);

  return recipients.length === 1 ? recipients[0] : recipients;
}

function stringMetadata(message: EmailMessage, key: string) {
  const value = message.metadata?.[key];

  return isStringMember(value) && value.length > 0 ? value : undefined;
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
