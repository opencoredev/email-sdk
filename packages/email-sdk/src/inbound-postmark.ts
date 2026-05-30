import type { InboundEmailAdapter } from "./inbound-types.js";
import {
  asRecord,
  firstString,
  normalizeAttachments,
  parseAddress,
  parseAddressList,
  parseHeaders,
  parseInboundInput,
  parseReferences,
} from "./inbound-utils.js";

export type PostmarkInboundOptions = Record<string, never>;

export function postmarkInbound(_options: PostmarkInboundOptions = {}): InboundEmailAdapter {
  return {
    name: "postmark",
    async parse(input) {
      const parsed = await parseInboundInput(input);
      const payload = asRecord(parsed.payload);
      const headers = parseHeaders(payload.Headers);
      const from = parseAddress(payload.FromFull ?? payload.From ?? headers.From) ?? { email: "" };

      return {
        id: firstString(payload, ["MessageID", "MessageId", "messageId"]),
        provider: "postmark",
        from,
        to: parseAddressList(payload.ToFull ?? payload.To ?? headers.To),
        cc: parseAddressList(payload.CcFull ?? payload.Cc ?? headers.Cc),
        bcc: parseAddressList(payload.BccFull ?? payload.Bcc ?? headers.Bcc),
        replyTo: parseAddressList(payload.ReplyTo ?? payload.ReplyToFull ?? headers["Reply-To"]),
        subject: firstString(payload, ["Subject"]) ?? headers.Subject,
        text: firstString(payload, ["TextBody"]),
        html: firstString(payload, ["HtmlBody"]),
        headers,
        attachments: normalizeAttachments(payload.Attachments),
        messageId: headers["Message-ID"] ?? firstString(payload, ["MessageID", "MessageId"]),
        inReplyTo: firstString(payload, ["InReplyTo"]) ?? headers["In-Reply-To"],
        references: parseReferences(payload.References ?? headers.References),
        raw: parsed.payload,
      };
    },
    raw: {
      verification: "none",
    },
  };
}
