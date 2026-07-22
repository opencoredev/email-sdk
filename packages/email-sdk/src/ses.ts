import { EmailAdapterError } from "./errors.js";
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

      const record = responseBody as Record<string, unknown>;
      const messageId = typeof record.MessageId === "string" ? record.MessageId : undefined;

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

async function signAwsRequest(input: {
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
  const payloadHash = await sha256Hex(input.body);
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
    await sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = await getSigningKey(
    input.secretAccessKey,
    dateStamp,
    input.region,
    input.service,
  );
  const signature = await hmacHex(signingKey, stringToSign);

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

async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", textBytes(value));
  return bytesToHex(new Uint8Array(digest));
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
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

async function hmac(key: string | Uint8Array, value: string) {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    typeof key === "string" ? textBytes(key) : toArrayBuffer(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, textBytes(value));
  return new Uint8Array(signature);
}

async function hmacHex(key: string | Uint8Array, value: string) {
  return bytesToHex(await hmac(key, value));
}

async function getSigningKey(
  secretAccessKey: string,
  dateStamp: string,
  region: string,
  service: string,
) {
  const dateKey = await hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = await hmac(dateKey, region);
  const serviceKey = await hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}

function textBytes(value: string) {
  return new TextEncoder().encode(value);
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function bytesToHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
