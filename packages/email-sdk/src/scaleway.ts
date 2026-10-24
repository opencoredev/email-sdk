import { EmailValidationError } from "./errors.js";
import { firstString, jsonProvider } from "./http.js";
import { jsonArray } from "./internal/decode.js";
import { apiAddress, apiAddresses, base64Attachments, optionalApiAddresses } from "./payloads.js";
import type { EmailMessage, EmailAdapter, EmailNativePassthrough } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertSupportedMessageFields,
  formatAddresses,
  headersToArray,
  arrayify,
  headerList,
  type MessageRules,
} from "./utils.js";

export type ScalewayAdapterOptions = {
  secretKey: string;
  projectId: string;
  region?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

const scalewayRules: MessageRules = (message) => {
  if (arrayify(message.replyTo).length === 0) return;

  const hasReplyHeader = headerList(message.headers).some(
    (header) => header.name.toLowerCase() === "reply-to",
  );

  if (hasReplyHeader) {
    throw new EmailValidationError("scaleway cannot set replyTo when headers already include Reply-To.");
  }
};

export function scaleway(
  options: ScalewayAdapterOptions,
): EmailAdapter<"scaleway", { baseUrl: string }, unknown, EmailNativePassthrough> {
  const region = options.region ?? "fr-par";

  return jsonProvider({
    name: "scaleway",
    rules: scalewayRules,
    baseUrl: options.baseUrl ?? "https://api.scaleway.com",
    endpoint: `/transactional-email/v1alpha1/regions/${region}/emails`,
    headers: {
      "X-Auth-Token": options.secretKey,
    },
    async buildPayload(message) {
      assertSupportedMessageFields("scaleway", message, SUPPORTED_MESSAGE_FIELDS.scaleway);
      const attachments = await base64Attachments(message);

      return {
        project_id: options.projectId,
        from: apiAddress(message.from),
        to: apiAddresses(message.to),
        cc: optionalApiAddresses(message.cc),
        bcc: optionalApiAddresses(message.bcc),
        subject: message.subject,
        text: message.text,
        html: message.html,
        additional_headers: scalewayHeaders(message),
        attachments: attachments?.map((attachment) => ({
          name: attachment.filename,
          type: attachment.contentType ?? "application/octet-stream",
          content: attachment.content,
        })),
      };
    },
    fetch: options.fetch,
    parseResponse(body) {
      return {
        adapter: "scaleway",
        // CreateEmail returns { emails: [{ id, ... }] }, one entry per recipient.
        id: firstString(body, ["id", "email_id"]) ?? firstString(jsonArray(body, "emails")[0], ["id", "message_id"]),
        raw: body,
      };
    },
  });
}

function scalewayHeaders(message: EmailMessage) {
  const headers =
    headersToArray(message.headers)?.map((header) => ({
      key: header.name,
      value: header.value,
    })) ?? [];

  const replyTo = formatAddresses(message.replyTo).join(", ");

  if (replyTo) {
    if (headers.some((header) => header.key.toLowerCase() === "reply-to")) {
      throw new EmailValidationError(
        "scaleway cannot set replyTo when headers already include Reply-To.",
      );
    }

    headers.push({ key: "Reply-To", value: replyTo });
  }

  return headers.length > 0 ? headers : undefined;
}
