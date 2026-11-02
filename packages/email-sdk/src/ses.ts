import { EmailAdapterError } from "./errors.js";
import { signAwsRequest } from "./internal/aws-sigv4.js";
import { jsonString } from "./internal/decode.js";
import {
  base64Attachments,
  commonHeadersArray,
  formatAddress,
  optionalStringAddresses,
  stringAddresses,
} from "./payloads.js";
import type { EmailMessage, EmailAdapter } from "./types.js";
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

export function ses(
  options: SesAdapterOptions,
): EmailAdapter<"ses", { baseUrl: string; region: string }> {
  const baseUrl = options.baseUrl ?? `https://email.${options.region}.amazonaws.com`;

  return {
    name: "ses",
    ...builtInAdapterDefinition("ses"),
    raw: { baseUrl, region: options.region },
    async send(message, context) {
      const fetcher = options.fetch ?? fetch;
      const endpoint = new URL("/v2/email/outbound-emails", baseUrl);
      const body = JSON.stringify(await toSesPayload(message, options));

      const headers = await signAwsRequest({
        accessKeyId: options.accessKeyId,
        secretAccessKey: options.secretAccessKey,
        sessionToken: options.sessionToken,
        region: options.region,
        service: "ses",
        method: "POST",
        url: endpoint,
        body,
        headers: {
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
