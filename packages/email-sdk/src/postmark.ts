import { EmailAdapterError } from "./errors.js";
import type { EmailAttachment, EmailMessage, EmailAdapter, EmailTag } from "./types.js";
import {
  builtInAdapterDefinition,
  attachmentToBase64,
  formatAddress,
  formatAddresses,
  headersToArray,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
  assertMaxItems,
  assertSupportedMessageFields,
  SUPPORTED_MESSAGE_FIELDS,
} from "./utils.js";

export type PostmarkAdapterOptions = {
  serverToken: string;
  baseUrl?: string;
  messageStream?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

export function postmark(
  options: PostmarkAdapterOptions,
): EmailAdapter<"postmark", { baseUrl: string }> {
  const baseUrl = options.baseUrl ?? "https://api.postmarkapp.com";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "postmark",
    ...builtInAdapterDefinition("postmark"),
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
        throw new EmailAdapterError(httpErrorMessage("Postmark", response.status, body), {
          adapter: "postmark",
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }

      const body = (await response.json()) as {
        MessageID?: string;
        SubmittedAt?: string;
        To?: string;
      };

      return {
        adapter: "postmark",
        id: body.MessageID,
        accepted: body.To ? [body.To] : undefined,
        raw: body,
      };
    },
  };
}

async function toPostmarkPayload(message: EmailMessage, messageStream?: string) {
  assertSupportedMessageFields("postmark", message, SUPPORTED_MESSAGE_FIELDS.postmark);
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

function firstPostmarkTag(tags: readonly EmailTag[] | undefined) {
  if (!tags || tags.length === 0) {
    return undefined;
  }

  assertMaxItems("postmark", "tag", tags, 1);

  const [first] = tags;
  return first ? `${first.name}:${first.value}` : undefined;
}
