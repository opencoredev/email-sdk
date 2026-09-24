import nodemailer from "nodemailer";
import type { SendMailOptions, SentMessageInfo } from "nodemailer";
import type Mail from "nodemailer/lib/mailer/index.js";
import type SMTPTransport from "nodemailer/lib/smtp-transport/index.js";

import { EmailAbortError, EmailAdapterError } from "./errors.js";
import { isStringMember } from "./internal/decode.js";
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
  tls?: SMTPTransport.Options["tls"];
  requireTLS?: boolean;
  allowInsecureAuth?: boolean;
  name?: string;
  heloName?: string;
  timeoutMs?: number;
};

export function smtp<const Name extends string = "smtp">(
  options: SmtpAdapterOptions & { name?: Name },
): EmailAdapter<Name, { host: string; port: number }> {
  // SAFETY: Name defaults to "smtp", so the fallback matches Name whenever options.name is absent.
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
        mail = await toNodemailerMessage(message, options.defaults, context.idempotencyKey);
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
        resolve(response);
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
): Promise<SendMailOptions> {
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

async function toNodemailerAttachment(attachment: EmailAttachment): Promise<Mail.Attachment> {
  const content = "content" in attachment ? await nodemailerContent(attachment.content) : undefined;

  const result: Mail.Attachment = {
    filename: attachment.filename,
    contentType: attachment.contentType,
    cid: attachment.contentId,
    contentDisposition: attachment.disposition,
  };

  if (content === undefined) {
    result.path = attachment.path;
  } else {
    result.content = content;
  }

  if (attachment.contentEncoding === "base64") {
    result.encoding = "base64";
  }

  return result;
}

async function nodemailerContent(
  content: EmailAttachment["content"],
): Promise<string | Buffer | undefined> {
  if (isStringMember(content)) return content;

  if (content instanceof ArrayBuffer) return Buffer.from(new Uint8Array(content));

  if (content instanceof Uint8Array) return Buffer.from(content);

  if (content instanceof Blob) return Buffer.from(await content.arrayBuffer());

  return undefined;
}
