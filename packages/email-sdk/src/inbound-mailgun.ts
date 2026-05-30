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
  verifyMailgunSignature,
} from "./inbound-utils.js";

export type MailgunInboundOptions = {
  signingKey?: string;
};

export function mailgunInbound(options: MailgunInboundOptions = {}): InboundEmailAdapter {
  const adapter: InboundEmailAdapter = {
    name: "mailgun",
    async parse(input) {
      const parsed = await parseInboundInput(input);
      const payload = asRecord(parsed.payload);
      const headers = parseHeaders(payload["message-headers"] ?? payload.headers);
      const from = parseAddress(payload.from ?? headers.From) ?? { email: "" };
      const to = parseAddressList(payload.recipient ?? payload.To ?? headers.To);

      return {
        id: firstString(payload, ["Message-Id", "message-id", "messageId"]),
        provider: "mailgun",
        from,
        to,
        cc: parseAddressList(payload.Cc ?? payload.cc ?? headers.Cc),
        bcc: parseAddressList(payload.Bcc ?? payload.bcc ?? headers.Bcc),
        replyTo: parseAddressList(payload["Reply-To"] ?? payload.replyTo ?? headers["Reply-To"]),
        subject: firstString(payload, ["subject", "Subject"]) ?? headers.Subject,
        text: firstString(payload, ["body-plain", "stripped-text", "text"]),
        html: firstString(payload, ["body-html", "stripped-html", "html"]),
        headers,
        attachments: normalizeAttachments(
          payload.attachments ?? collectMailgunAttachments(payload),
        ),
        messageId: firstString(payload, ["Message-Id", "message-id"]) ?? headers["Message-ID"],
        inReplyTo: firstString(payload, ["In-Reply-To", "in-reply-to"]) ?? headers["In-Reply-To"],
        references: parseReferences(payload.References ?? payload.references ?? headers.References),
        raw: parsed.payload,
      };
    },
    raw: {
      verification: options.signingKey ? "hmac-sha256" : "none",
    },
  };

  return adapterWithOptionalVerify(
    adapter,
    options.signingKey
      ? async (input) => {
          const parsed = await parseInboundInput(input);
          const payload = asRecord(parsed.payload);
          const signature = asRecord(payload.signature);

          return verifyMailgunSignature({
            signingKey: options.signingKey!,
            timestamp: firstString(signature, ["timestamp"]) ?? firstString(payload, ["timestamp"]),
            token: firstString(signature, ["token"]) ?? firstString(payload, ["token"]),
            signature: firstString(signature, ["signature"]) ?? firstString(payload, ["signature"]),
          });
        }
      : undefined,
  );
}

function collectMailgunAttachments(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([key]) => key.startsWith("attachment-"))
    .map(([, value]) => value);
}
