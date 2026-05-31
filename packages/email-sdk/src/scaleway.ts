import { firstString, jsonProvider } from "./http.js";
import { formatAddress, formatAddresses, optionalStringAddresses } from "./payloads.js";
import type { EmailProvider } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertSupportedMessageFields,
  headersToObject,
} from "./utils.js";

export type ScalewayProviderOptions = {
  secretKey: string;
  projectId: string;
  region?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
};

export function scaleway(options: ScalewayProviderOptions): EmailProvider<{ baseUrl: string }> {
  const region = options.region ?? "fr-par";

  return jsonProvider({
    name: "scaleway",
    baseUrl: options.baseUrl ?? "https://api.scaleway.com",
    endpoint: `/transactional-email/v1alpha1/regions/${region}/emails`,
    headers: {
      "X-Auth-Token": options.secretKey,
    },
    buildPayload(message) {
      assertSupportedMessageFields("scaleway", message, SUPPORTED_MESSAGE_FIELDS.scaleway);

      return {
        project_id: options.projectId,
        from: formatAddress(message.from),
        to: formatAddresses(message.to),
        cc: optionalStringAddresses(message.cc),
        bcc: optionalStringAddresses(message.bcc),
        subject: message.subject,
        text: message.text,
        html: message.html,
        additional_headers: headersToObject(message.headers),
      };
    },
    fetch: options.fetch,
    parseResponse(body) {
      return {
        provider: "scaleway",
        id: firstString(body as Record<string, unknown>, ["id", "email_id"]),
        raw: body,
      };
    },
  });
}
