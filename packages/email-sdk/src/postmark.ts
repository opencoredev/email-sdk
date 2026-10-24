import { EmailAdapterError } from "./errors.js";
import { jsonString, responseJson } from "./internal/decode.js";
import type {
  EmailAttachment,
  EmailMessage,
  EmailAdapter,
  EmailNativeObject,
  EmailNativePassthrough,
  EmailTag,
} from "./types.js";
import {
  arrayify,
  builtInAdapterDefinition,
  attachmentToBase64,
  emailAddressOf,
  formatAddress,
  formatAddresses,
  headersToArray,
  httpErrorMessage,
  isRetryableStatus,
  readErrorBody,
  assertMaxItems,
  mapAttachments,
  assertSupportedMessageFields,
  SUPPORTED_MESSAGE_FIELDS,
  type MessageRules,
} from "./utils.js";

export type PostmarkAdapterOptions = {
  serverToken: string;
  baseUrl?: string;
  messageStream?: string;
  fetch?: typeof fetch;
  headers?: Record<string, string>;
};

/** Which parts of the message Postmark rewrites to track link clicks (`TrackLinks`). */
export type PostmarkTrackLinks = "None" | "HtmlAndText" | "HtmlOnly" | "TextOnly";

/** Identify a Postmark template by numeric ID or by alias, not both. */
export type PostmarkTemplateRef =
  | { id: number; alias?: never }
  | { alias: string; id?: never };

/**
 * Experimental. Postmark-only send options, passed as `native: { postmark: { ... } }`.
 * https://postmarkapp.com/developer/api/email-api
 */
export type PostmarkNativeOptions = EmailNativePassthrough & {
  /** Overrides the adapter's `messageStream` for this send. */
  messageStream?: string;
  trackOpens?: boolean;
  trackLinks?: PostmarkTrackLinks;
  /** Sent as Postmark's single `Tag` in place of the `name:value` tag built from `message.tags`. */
  tag?: string;
  /**
   * Send through `/email/withTemplate`. The template supplies the subject and body, so the
   * message's `subject`, `html`, and `text` are not sent.
   */
  template?: PostmarkTemplateRef & {
    model?: EmailNativeObject;
    inlineCss?: boolean;
  };
};

const postmarkRules: MessageRules = (message) => {
  assertMaxItems("postmark", "tag", message.tags ?? [], 1);
};

export function postmark(
  options: PostmarkAdapterOptions,
): EmailAdapter<"postmark", { baseUrl: string }, unknown, PostmarkNativeOptions> {
  const baseUrl = options.baseUrl ?? "https://api.postmarkapp.com";
  const fetcher = options.fetch ?? fetch;

  return {
    name: "postmark",
    ...builtInAdapterDefinition("postmark", postmarkRules),
    raw: { baseUrl },
    async send(message, context) {
      const native = context.native;
      const payload = await toPostmarkPayload(message, options.messageStream);
      const endpoint = native?.template ? "/email/withTemplate" : "/email";

      const response = await fetcher(`${baseUrl}${endpoint}`, {
        method: "POST",
        signal: context.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "X-Postmark-Server-Token": options.serverToken,
          ...options.headers,
          ...native?.headers,
        },
        body: JSON.stringify(native ? withPostmarkNative(payload, native) : payload),
      });

      if (!response.ok) {
        const body = await readErrorBody(response);
        throw new EmailAdapterError(httpErrorMessage("Postmark", response.status, body), {
          adapter: "postmark",
          status: response.status,
          retryable: isRetryableStatus(response.status),
        });
      }

      const body = await responseJson(response);

      // A 200 means Postmark accepted the whole message. Its "To" field is one comma-joined
      // string and omits Cc/Bcc, so list the submitted recipients instead.
      const accepted = [message.to, message.cc, message.bcc].flatMap(list => arrayify(list).map(emailAddressOf));

      return {
        adapter: "postmark",
        id: jsonString(body, "MessageID"),
        accepted,
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
    Attachments: await mapAttachments(message.attachments, toPostmarkAttachment),
    Metadata: message.metadata,
    MessageStream: messageStream,
    Tag: tag,
  };
}

type PostmarkPayload = Awaited<ReturnType<typeof toPostmarkPayload>>;

function withPostmarkNative(payload: PostmarkPayload, native: PostmarkNativeOptions) {
  const template = native.template;

  const withNative = {
    ...payload,
    MessageStream: native.messageStream ?? payload.MessageStream,
    Tag: native.tag ?? payload.Tag,
    TrackOpens: native.trackOpens,
    TrackLinks: native.trackLinks,
    ...(template && {
      Subject: undefined,
      HtmlBody: undefined,
      TextBody: undefined,
      TemplateId: template.id,
      TemplateAlias: template.alias,
      TemplateModel: template.model ?? {},
      InlineCss: template.inlineCss,
    }),
  };

  return native.body ? { ...withNative, ...native.body } : withNative;
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
