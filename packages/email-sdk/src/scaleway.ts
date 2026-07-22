import { EmailValidationError } from "./errors.js";
import { firstString, jsonProvider } from "./http.js";
import { apiAddress, apiAddresses, base64Attachments, optionalApiAddresses } from "./payloads.js";
import type { EmailMessage, EmailAdapter } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertSupportedMessageFields,
  formatAddresses,
  headersToArray,
} from "./utils.js";

export type ScalewayAdapterOptions = {
  secretKey: string;
  projectId: string;
  region?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function scaleway(
  options: ScalewayAdapterOptions,
): EmailAdapter<"scaleway", { baseUrl: string }> {
  const region = options.region ?? "fr-par";

  return jsonProvider({
    name: "scaleway",
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
        id: firstString(body as Record<string, unknown>, ["id", "email_id"]),
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
