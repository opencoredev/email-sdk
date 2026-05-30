import { EmailProviderError } from "./errors.js";
import type { EmailAttachment, EmailMessage, EmailProvider, EmailTag } from "./types.js";
import {
  attachmentToBase64,
  formatAddress,
  formatAddresses,
  headersToArray,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
  assertMaxItems,
} from "./utils.js";

export type PostmarkProviderOptions = {
  serverToken: string;
  baseUrl?: string;
  messageStream?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

export function postmark(options: PostmarkProviderOptions): EmailProvider<{ baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.postmarkapp.com";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "postmark",
    raw: { baseUrl },
    async send(message, context) {
      const response = await fetcher(`${baseUrl}/email`, {
        method: "POST",
        signal: context.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": options.serverToken,
          ...options.headers,
        },
        body: JSON.stringify(await toPostmarkPayload(message, options.messageStream)),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailProviderError(httpErrorMessage("Postmark", response.status, body), {
          provider: "postmark",
          status: response.status,
          retryable: isRetryableStatus(response.status),
          details: body,
        });
      }

      const body = (await response.json()) as {
        MessageID?: string;
        SubmittedAt?: string;
        To?: string;
      };

      return {
        provider: "postmark",
        id: body.MessageID,
        messageId: body.MessageID,
        accepted: body.To ? [body.To] : undefined,
        raw: body,
      };
    },
  };
}

async function toPostmarkPayload(message: EmailMessage, messageStream?: string) {
  const tag = firstPostmarkTag(message.tags);

  return {
    From: formatAddress(message.from),
    To: formatAddresses(message.to).join(", "),
    Cc: formatAddresses(message.cc).join(", ") || undefined,
    Bcc: formatAddresses(message.bcc).join(", ") || undefined,
    ReplyTo: formatAddresses(message.replyTo).join(", ") || undefined,
    Subject: message.subject,
    HtmlBody: message.html,
    TextBody: message.text,
    Headers: headersToArray(message.headers)?.map((header) => ({
      Name: header.name,
      Value: header.value,
    })),
    Attachments: await Promise.all((message.attachments ?? []).map(toPostmarkAttachment)),
    Metadata: message.metadata,
    MessageStream: messageStream,
    Tag: tag,
  };
}

async function toPostmarkAttachment(attachment: EmailAttachment) {
  const content = await attachmentToBase64(attachment);

  return {
    Name: attachment.filename,
    Content: content,
    ContentType: attachment.contentType ?? "application/octet-stream",
    ContentID: attachment.contentId,
  };
}

function firstPostmarkTag(tags: EmailTag[] | undefined) {
  if (!tags || tags.length === 0) {
    return undefined;
  }

  assertMaxItems("postmark", "tag", tags, 1);

  const [first] = tags;
  return first ? `${first.name}:${first.value}` : undefined;
}
