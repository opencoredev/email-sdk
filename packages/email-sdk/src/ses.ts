import { createHash, createHmac } from "node:crypto";

import { EmailProviderError } from "./errors.js";
import {
  base64Attachments,
  commonHeadersArray,
  formatAddress,
  optionalStringAddresses,
  stringAddresses,
} from "./payloads.js";
import type { EmailMessage, EmailProvider } from "./types.js";
import {
  assertSupportedMessageFields,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
} from "./utils.js";

export type SesProviderOptions = {
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
  options: SesProviderOptions,
): EmailProvider<{ baseUrl: string; region: string }> {
  const baseUrl = options.baseUrl ?? `https://email.${options.region}.amazonaws.com`;

  return {
    name: "ses",
    raw: { baseUrl, region: options.region },
    async send(message, context) {
      const fetcher = options.fetch ?? fetch;
      const endpoint = new URL("/v2/email/outbound-emails", baseUrl);
      const body = JSON.stringify(await toSesPayload(message, options));
      const headers = signAwsRequest({
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
        throw new EmailProviderError(httpErrorMessage("ses", response.status, responseBody), {
          provider: "ses",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          details: responseBody,
        });
      }

      const record = responseBody as Record<string, unknown>;
      const messageId = typeof record.MessageId === "string" ? record.MessageId : undefined;

      return {
        provider: "ses",
        id: messageId,
        messageId,
        raw: responseBody,
      };
    },
  };
}

async function toSesPayload(message: EmailMessage, options: SesProviderOptions) {
  assertSupportedMessageFields("ses", message, {
    cc: true,
    bcc: true,
    replyTo: true,
    headers: true,
    attachments: true,
    tags: true,
  });

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

function signAwsRequest(input: {
  accessKeyId: string;
  secretAccessKey: string;
  sessionToken?: string;
  region: string;
  service: string;
  method: string;
  url: URL;
  body: string;
  headers: Record<string, string>;
}) {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(input.body);
  const requestHeaders = {
    ...input.headers,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(input.sessionToken ? { "x-amz-security-token": input.sessionToken } : {}),
  };
  const canonicalHeaders = Object.entries({
    ...requestHeaders,
    host: input.url.host,
  })
    .map(([name, value]) => [name.toLowerCase(), value.trim()] as const)
    .sort(([left], [right]) => left.localeCompare(right));
  const signedHeaders = canonicalHeaders.map(([name]) => name).join(";");
  const credentialScope = `${dateStamp}/${input.region}/${input.service}/aws4_request`;
  const canonicalRequest = [
    input.method,
    input.url.pathname,
    canonicalQueryString(input.url.searchParams),
    canonicalHeaders.map(([name, value]) => `${name}:${value}\n`).join(""),
    signedHeaders,
    payloadHash,
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSigningKey(input.secretAccessKey, dateStamp, input.region, input.service);
  const signature = hmacHex(signingKey, stringToSign);

  return {
    ...requestHeaders,
    Authorization: [
      `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${credentialScope}`,
      `SignedHeaders=${signedHeaders}`,
      `Signature=${signature}`,
    ].join(", "),
  };
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256Hex(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function canonicalQueryString(searchParams: URLSearchParams) {
  return [...searchParams.entries()]
    .map(([key, value]) => [awsEncode(key), awsEncode(value)] as const)
    .sort(([leftKey, leftValue], [rightKey, rightValue]) => {
      const keyOrder = leftKey.localeCompare(rightKey);
      return keyOrder === 0 ? leftValue.localeCompare(rightValue) : keyOrder;
    })
    .map(([key, value]) => `${key}=${value}`)
    .join("&");
}

function awsEncode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function hmac(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: string | Buffer, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function getSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}
