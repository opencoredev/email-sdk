import nodemailer from "nodemailer";
import type { SendMailOptions, SentMessageInfo } from "nodemailer";

import { EmailAbortError, EmailAdapterError } from "./errors.js";
import { isRetryableSmtpError, smtpDeliveryState } from "./smtp-errors.js";
import type { EmailAdapter, EmailAttachment, EmailMessage } from "./types.js";
import {
  BUILT_IN_ADAPTER_CAPABILITIES,
  formatAddress,
  formatAddresses,
  headersToArray,
  validateBuiltInAdapter,
} from "./utils.js";

export type SmtpAdapterOptions = {
  host: string;
  port?: number;
  secure?: boolean;
  auth?: {
    user: string;
    pass: string;
    method?: "plain" | "login";
  };
  defaults?: {
    replyTo?: string;
  };
  tls?: Record<string, unknown>;
  requireTLS?: boolean;
  allowInsecureAuth?: boolean;
  name?: string;
  heloName?: string;
  timeoutMs?: number;
};

export function smtp<const Name extends string = "smtp">(
  options: SmtpAdapterOptions & { name?: Name },
): EmailAdapter<Name, { host: string; port: number }> {
  const name = (options.name ?? "smtp") as Name;
  const port = options.port ?? (options.secure ? 465 : 587);

  return {
    name,
    capabilities: BUILT_IN_ADAPTER_CAPABILITIES.smtp,
    validate(message) {
      validateBuiltInAdapter("smtp", message);
    },
    raw: { host: options.host, port },
    async send(message, context) {
      validateBuiltInAdapter("smtp", message);

      let mail: SendMailOptions;
      try {
        mail = (await toNodemailerMessage(
          message,
          options.defaults,
          context.idempotencyKey,
        )) as SendMailOptions;
      } catch (error) {
        throw new EmailAdapterError(
          error instanceof Error ? error.message : "SMTP message preparation failed.",
          { adapter: name, delivery: "not_sent", retryable: false, cause: error },
        );
      }

      const transport = nodemailer.createTransport({
        host: options.host,
        port,
        secure: options.secure ?? port === 465,
        auth: options.auth,
        authMethod: options.auth?.method?.toUpperCase(),
        requireTLS: options.requireTLS ?? Boolean(options.auth && !options.allowInsecureAuth),
        name: options.heloName,
        tls: options.tls,
        connectionTimeout: options.timeoutMs ?? 15_000,
        greetingTimeout: options.timeoutMs ?? 15_000,
        socketTimeout: options.timeoutMs ?? 15_000,
      });

      try {
        const response = await sendMailWithSignal(transport, mail, context.signal);
        return {
          adapter: name,
          id: parseQueueIdentifier(response.response) ?? context.idempotencyKey ?? response.messageId,
          accepted: (response.accepted ?? []).map(String),
          rejected: (response.rejected ?? []).map(String),
          raw: response,
        };
      } catch (error) {
        if (error instanceof EmailAbortError) throw error;
        throw new EmailAdapterError(error instanceof Error ? error.message : "SMTP send failed.", {
          adapter: name,
          retryable: isRetryableSmtpError(error),
          delivery: smtpDeliveryState(error),
          cause: error,
        });
      } finally {
        transport.close();
      }
    },
  };
}
function parseQueueIdentifier(response: string | undefined) {
  return response?.match(/\bqueued\s+as\s+([^\s]+)/i)?.[1];
}

function sendMailWithSignal(
  transport: ReturnType<typeof nodemailer.createTransport>,
  mail: SendMailOptions,
  signal: AbortSignal | undefined,
) {
  if (signal?.aborted) return Promise.reject(new EmailAbortError(signal.reason));

  return new Promise<SentMessageInfo>((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      transport.close();
      reject(new EmailAbortError(signal?.reason));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    transport.sendMail(mail).then(
      (response) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        resolve(response as SentMessageInfo);
      },
      (error) => {
        if (settled) return;
        settled = true;
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

async function toNodemailerMessage(
  message: EmailMessage,
  defaults: SmtpAdapterOptions["defaults"],
  idempotencyKey?: string,
) {
  const to = formatAddresses(message.to);
  const cc = formatAddresses(message.cc);
  const bcc = formatAddresses(message.bcc);
  const attachments = await Promise.all((message.attachments ?? []).map(toNodemailerAttachment));

  return {
    from: formatAddress(message.from),
    to,
    cc: cc.length > 0 ? cc : undefined,
    bcc: bcc.length > 0 ? bcc : undefined,
    replyTo: message.replyTo ? formatAddresses(message.replyTo) : defaults?.replyTo,
    subject: message.subject,
    text: message.text,
    html: message.html,
    headers: headersToArray(message.headers)?.map((header) => ({ key: header.name, value: header.value })),
    attachments,
    messageId: idempotencyKey ? `<${idempotencyKey}@email-sdk.local>` : undefined,
    envelope: {
      from: formatAddress(message.from),
      to: [...to, ...cc, ...bcc],
    },
  };
}

async function toNodemailerAttachment(attachment: EmailAttachment) {
  let content: string | Buffer | undefined = "content" in attachment
    ? typeof attachment.content === "string"
      ? attachment.content
      : attachment.content instanceof ArrayBuffer
        ? Buffer.from(new Uint8Array(attachment.content))
        : attachment.content instanceof Uint8Array
          ? Buffer.from(attachment.content)
          : undefined
    : undefined;

  if ("content" in attachment && attachment.content instanceof Blob) {
    content = Buffer.from(await attachment.content.arrayBuffer());
  }

  return {
    filename: attachment.filename,
    ...(content !== undefined ? { content } : { path: attachment.path }),
    contentType: attachment.contentType,
    cid: attachment.contentId,
    contentDisposition: attachment.disposition,
    ...(attachment.contentEncoding === "base64" ? { encoding: "base64" as const } : {}),
  };
}
