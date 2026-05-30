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
  verifySendGridEcdsaSignature,
} from "./inbound-utils.js";

export type SendGridInboundOptions = {
  publicKey?: string;
};

export function sendgridInbound(options: SendGridInboundOptions = {}): InboundEmailAdapter {
  const adapter: InboundEmailAdapter = {
    name: "sendgrid",
    async parse(input) {
      const parsed = await parseInboundInput(input);
      const payload = asRecord(parsed.payload);
      const envelope = parseJsonRecord(payload.envelope);
      const headers = parseHeaders(payload.headers);
      const from = parseAddress(payload.from ?? payload.sender ?? headers.From) ?? { email: "" };
      const to = parseAddressList(payload.to ?? envelope.to ?? headers.To);

      return {
        id: firstString(payload, ["Message-ID", "message-id", "messageId"]),
        provider: "sendgrid",
        from,
        to,
        cc: parseAddressList(payload.cc ?? headers.Cc),
        bcc: parseAddressList(payload.bcc ?? headers.Bcc),
        replyTo: parseAddressList(payload.replyTo ?? payload["Reply-To"] ?? headers["Reply-To"]),
        subject: firstString(payload, ["subject", "Subject"]) ?? headers.Subject,
        text: firstString(payload, ["text"]),
        html: firstString(payload, ["html"]),
        headers,
        attachments: normalizeAttachments(
          payload.attachments ?? collectSendGridAttachments(payload),
        ),
        messageId: firstString(payload, ["Message-ID", "message-id"]) ?? headers["Message-ID"],
        inReplyTo: firstString(payload, ["in-reply-to", "In-Reply-To"]) ?? headers["In-Reply-To"],
        references: parseReferences(payload.references ?? payload.References ?? headers.References),
        raw: parsed.payload,
      };
    },
    raw: {
      verification: options.publicKey ? "ecdsa-sha256" : "none",
    },
  };

  return adapterWithOptionalVerify(
    adapter,
    options.publicKey
      ? async (input) => {
          const parsed = await parseInboundInput(input);
          return verifySendGridEcdsaSignature({
            publicKey: options.publicKey!,
            timestamp:
              parsed.headers.get("x-twilio-email-event-webhook-timestamp") ??
              parsed.headers.get("x-sendgrid-eventwebhook-timestamp"),
            signature:
              parsed.headers.get("x-twilio-email-event-webhook-signature") ??
              parsed.headers.get("x-sendgrid-eventwebhook-signature"),
            payload: parsed.rawBody,
          });
        }
      : undefined,
  );
}

function parseJsonRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") {
    return asRecord(value);
  }

  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function collectSendGridAttachments(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([key, value]) => /^attachment\d+$/.test(key) && value instanceof File)
    .map(([, value]) => value);
}
