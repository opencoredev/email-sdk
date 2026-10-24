import { EmailAdapterError } from "./errors.js";
import { createSigningKeyCache, signAwsRequest } from "./internal/aws-sigv4.js";
import { jsonString } from "./internal/decode.js";
import {
  base64Attachments,
  commonHeadersArray,
  formatAddress,
  optionalStringAddresses,
  stringAddresses,
} from "./payloads.js";
import type {
  EmailMessage,
  EmailAdapter,
  EmailNativeObject,
  EmailNativePassthrough,
} from "./types.js";
import {
  builtInAdapterDefinition,
  SUPPORTED_MESSAGE_FIELDS,
  assertSupportedMessageFields,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
} from "./utils.js";

export type SesAdapterOptions = {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  sessionToken?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  charset?: string;
  configurationSetName?: string;
};

/** Identify a stored SES template by name or ARN, not both. */
export type SesTemplateRef = { name: string; arn?: never } | { arn: string; name?: never };

/**
 * Experimental. SES-only send options, passed as `native: { ses: { ... } }`.
 * https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_SendEmail.html
 */
export type SesNativeOptions = EmailNativePassthrough & {
  /** Overrides the adapter's `configurationSetName` for this send. */
  configurationSetName?: string;
  /**
   * Send a stored SES template (`Content.Template`). The template supplies the subject and body,
   * so the message's `subject`, `html`, and `text` are not sent. Headers and attachments are.
   */
  template?: SesTemplateRef & { data?: EmailNativeObject };
  /** Subscription management for a contact list (`ListManagementOptions`). */
  listManagement?: { contactListName: string; topicName?: string };
  feedbackForwardingEmailAddress?: string;
};

export function ses(
  options: SesAdapterOptions,
): EmailAdapter<"ses", { baseUrl: string; region: string }, unknown, SesNativeOptions> {
  const baseUrl = options.baseUrl ?? `https://email.${options.region}.amazonaws.com`;
  const signingKeys = createSigningKeyCache();

  return {
    name: "ses",
    ...builtInAdapterDefinition("ses"),
    raw: { baseUrl, region: options.region },
    async send(message, context) {
      const fetcher = options.fetch ?? fetch;
      // Built per send so an invalid baseUrl still fails the send, not the adapter factory.
      const endpoint = new URL("/v2/email/outbound-emails", baseUrl);
      const native = context.native;
      const payload = await toSesPayload(message, options);
      const body = JSON.stringify(native ? withSesNative(payload, native) : payload);

      // Credentials are read on every send so refreshed STS credentials take effect.
      const headers = await signAwsRequest(signingKeys, {
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        sessionToken: options.sessionToken,
        region: options.region,
        service: "ses",
        method: "POST",
        url: endpoint,
        body,
        headers: {
          ...native?.headers,
          "content-type": "application/json",
        },
      });

      const response = await fetcher(endpoint, {
        method: "POST",
        signal: context.signal,
        headers,
        body,
      });

      const responseBody = await readErrorBody(response);

      if (!response.ok) {
        throw new EmailAdapterError(httpErrorMessage("ses", response.status, responseBody), {
          adapter: "ses",
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }

      const messageId = jsonString(responseBody, "MessageId");

      return {
        adapter: "ses",
        id: messageId,
        raw: responseBody,
      };
    },
  };
}

async function toSesPayload(message: EmailMessage, options: SesAdapterOptions) {
  assertSupportedMessageFields("ses", message, SUPPORTED_MESSAGE_FIELDS.ses);

  const charset = options.charset ?? "UTF-8";
  const attachments = await base64Attachments(message);

  return {
    ConfigurationSetName: options.configurationSetName,
    FromEmailAddress: formatAddress(message.from),
    Destination: {
      ToAddresses: stringAddresses(message.to),
      CcAddresses: optionalStringAddresses(message.cc),
      BccAddresses: optionalStringAddresses(message.bcc),
    },
    ReplyToAddresses: optionalStringAddresses(message.replyTo),
    EmailTags: message.tags?.map((tag) => ({
      Name: tag.name,
      Value: tag.value,
    })),
    Content: {
      Simple: {
        Subject: {
          Data: message.subject,
          Charset: charset,
        },
        Body: {
          Text: message.text
            ? {
                Data: message.text,
                Charset: charset,
              }
            : undefined,
          Html: message.html
            ? {
                Data: message.html,
                Charset: charset,
              }
            : undefined,
        },
        Headers: commonHeadersArray(message)?.map((header) => ({
          Name: header.name,
          Value: header.value,
        })),
        Attachments: attachments?.map((attachment) => ({
          FileName: attachment.filename,
          RawContent: attachment.content,
          ContentType: attachment.contentType,
          ContentId: attachment.contentId,
          ContentDisposition: attachment.disposition?.toUpperCase(),
          ContentTransferEncoding: "BASE64",
        })),
      },
    },
  };
}

type SesPayload = Awaited<ReturnType<typeof toSesPayload>>;

function withSesNative(payload: SesPayload, native: SesNativeOptions) {
  const template = native.template;
  const simple = payload.Content.Simple;
  const listManagement = native.listManagement;

  const withNative = {
    ...payload,
    ConfigurationSetName: native.configurationSetName ?? payload.ConfigurationSetName,
    FeedbackForwardingEmailAddress: native.feedbackForwardingEmailAddress,
    ListManagementOptions: listManagement && {
      ContactListName: listManagement.contactListName,
      TopicName: listManagement.topicName,
    },
    Content: template
      ? {
          Template: {
            TemplateName: template.name,
            TemplateArn: template.arn,
            TemplateData: JSON.stringify(template.data ?? {}),
            Headers: simple.Headers,
            Attachments: simple.Attachments,
          },
        }
      : payload.Content,
  };

  return native.body ? { ...withNative, ...native.body } : withNative;
}
