import type { InboundEmailAdapter } from "./inbound-types.js";
import {
  adapterWithOptionalVerify,
  asRecord,
  firstString,
  normalizeAttachments,
  parseAddress,
  parseAddressList,
  parseHeaders,
  parseInboundInput,
  parseReferences,
  verifySvixSignature,
} from "./inbound-utils.js";

export type ResendInboundOptions = {
  webhookSecret?: string;
};

export function resendInbound(options: ResendInboundOptions = {}): InboundEmailAdapter {
  const adapter: InboundEmailAdapter = {
    name: "resend",
    async parse(input) {
      const parsed = await parseInboundInput(input);
      const event = asRecord(parsed.payload);
      const data = asRecord(event.data ?? event.email ?? event);
      const headers = parseHeaders(data.headers);
      const from = parseAddress(data.from) ?? { email: "" };

      return {
        id: firstString(data, ["email_id", "emailId", "id"]),
        provider: "resend",
        from,
        to: parseAddressList(data.to),
        cc: parseAddressList(data.cc),
        bcc: parseAddressList(data.bcc),
        replyTo: parseAddressList(data.reply_to ?? data.replyTo),
        subject: firstString(data, ["subject"]),
        text: firstString(data, ["text", "textBody"]),
        html: firstString(data, ["html", "htmlBody"]),
        headers,
        attachments: normalizeAttachments(data.attachments),
        messageId: firstString(data, ["message_id", "messageId"]) ?? headers["Message-ID"],
        inReplyTo: firstString(data, ["in_reply_to", "inReplyTo"]) ?? headers["In-Reply-To"],
        references: parseReferences(data.references ?? headers.References),
        receivedAt: parseDate(data.created_at ?? data.createdAt ?? data.received_at),
        raw: parsed.payload,
      };
    },
    raw: {
      verification: options.webhookSecret ? "svix" : "none",
    },
  };

  return adapterWithOptionalVerify(
    adapter,
    options.webhookSecret
      ? async (input) => {
          const parsed = await parseInboundInput(input);
          return verifySvixSignature({
            secret: options.webhookSecret!,
            id: parsed.headers.get("svix-id"),
            timestamp: parsed.headers.get("svix-timestamp"),
            signature: parsed.headers.get("svix-signature"),
            payload: parsed.rawBody,
          });
        }
      : undefined,
  );
}

function parseDate(value: unknown): Date | undefined {
  if (typeof value !== "string" && typeof value !== "number") {
    return undefined;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}
