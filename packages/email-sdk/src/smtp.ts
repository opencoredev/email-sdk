import { randomUUID } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

import { EmailProviderError, EmailValidationError } from "./errors.js";
import type { EmailAddress, EmailAttachment, EmailMessage, EmailProvider } from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  assertSupportedMessageFields,
  attachmentToBytes,
  formatAddress,
  formatAddresses,
  headersToArray,
  headersToObject,
} from "./utils.js";

type Socket = net.Socket | tls.TLSSocket;

export type SmtpProviderOptions = {
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
  tls?: tls.ConnectionOptions;
  requireTLS?: boolean;
  allowInsecureAuth?: boolean;
  name?: string;
  heloName?: string;
  timeoutMs?: number;
};

export function smtp(options: SmtpProviderOptions): EmailProvider<{ host: string; port: number }> {
  const name = options.name ?? "smtp";
  const port = options.port ?? (options.secure ? 465 : 587);

  return {
    name,
    raw: {
      host: options.host,
      port,
    },
    async send(message) {
      assertSupportedMessageFields(name, message, SUPPORTED_MESSAGE_FIELDS.smtp);
      assertSmtpMessage(message);
      const raw = await buildMimeMessage(message, options.defaults);
      const client = new SmtpClient(options, port);

      try {
        const response = await client.send(message, raw);

        return {
          provider: name,
          id: response.messageId,
          messageId: response.messageId,
          accepted: response.accepted,
          rejected: [],
          raw: response,
        };
      } catch (error) {
        throw new EmailProviderError(error instanceof Error ? error.message : "SMTP send failed.", {
          provider: name,
          retryable: true,
          cause: error,
        });
      } finally {
        client.close();
      }
    },
  };
}

class SmtpClient {
  private socket?: Socket;
  private buffer = "";
  private readonly pending: Array<(line: string) => void> = [];

  constructor(
    private readonly options: SmtpProviderOptions,
    private readonly port: number,
  ) {}

  async send(message: EmailMessage, raw: string) {
    await this.connect();
    await this.expect([220]);
    await this.command(`EHLO ${this.options.heloName ?? "localhost"}`, [250]);

    const shouldStartTls =
      !this.options.secure &&
      (this.options.requireTLS || (Boolean(this.options.auth) && !this.options.allowInsecureAuth));

    if (shouldStartTls) {
      await this.command("STARTTLS", [220]);
      await this.upgradeToTls();
      await this.command(`EHLO ${this.options.heloName ?? "localhost"}`, [250]);
    }

    if (
      this.options.auth &&
      !this.options.secure &&
      !shouldStartTls &&
      !this.options.allowInsecureAuth
    ) {
      throw new Error("SMTP auth requires TLS. Set secure, requireTLS, or allowInsecureAuth.");
    }

    if (this.options.auth) {
      await this.authenticate();
    }

    const from = envelopeAddress(message.from);
    const recipients = [
      ...formatAddresses(message.to),
      ...formatAddresses(message.cc),
      ...formatAddresses(message.bcc),
    ].map(parseEmailAddress);

    await this.command(`MAIL FROM:<${from}>`, [250]);

    const accepted: string[] = [];

    for (const recipient of recipients) {
      await this.command(`RCPT TO:<${recipient}>`, [250, 251]);
      accepted.push(recipient);
    }

    await this.command("DATA", [354]);
    const response = await this.command(`${escapeData(raw)}\r\n.`, [250]);
    await this.command("QUIT", [221]).catch(() => undefined);

    return {
      messageId: extractSmtpMessageId(response) ?? message.idempotencyKey,
      accepted,
      response,
    };
  }

  close() {
    this.socket?.destroy();
  }

  private connect() {
    return new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      const onTimeout = () => reject(new Error("SMTP connection timed out."));
      const socket = this.options.secure
        ? tls.connect({
            host: this.options.host,
            port: this.port,
            servername: this.options.host,
            timeout: this.options.timeoutMs ?? 15_000,
            ...this.options.tls,
          })
        : net.connect({
            host: this.options.host,
            port: this.port,
            timeout: this.options.timeoutMs ?? 15_000,
          });

      this.socket = socket;
      socket.setEncoding("utf8");
      socket.once("error", onError);
      socket.once("timeout", onTimeout);
      socket.once("connect", () => {
        socket.off("error", onError);
        socket.off("timeout", onTimeout);
        resolve();
      });
      socket.on("data", (chunk: string) => this.onData(chunk));
      socket.on("error", (error) => {
        const pending = this.pending.shift();
        pending?.(`599 ${error.message}`);
      });
    });
  }

  private upgradeToTls() {
    return new Promise<void>((resolve, reject) => {
      const current = this.socket;

      if (!current) {
        throw new Error("SMTP socket is not connected.");
      }

      current.removeAllListeners("data");
      const secure = tls.connect({
        socket: current,
        servername: this.options.host,
        timeout: this.options.timeoutMs ?? 15_000,
        ...this.options.tls,
      });

      this.socket = secure;
      secure.setEncoding("utf8");
      secure.on("data", (chunk: string) => this.onData(chunk));
      secure.once("error", reject);
      secure.once("timeout", () => reject(new Error("SMTP TLS upgrade timed out.")));
      secure.once("secureConnect", () => resolve());
    });
  }

  private async authenticate() {
    const auth = this.options.auth;

    if (!auth) {
      return;
    }

    if (auth.method === "login") {
      await this.command("AUTH LOGIN", [334]);
      await this.command(Buffer.from(auth.user).toString("base64"), [334]);
      await this.command(Buffer.from(auth.pass).toString("base64"), [235]);
      return;
    }

    const payload = Buffer.from(`\0${auth.user}\0${auth.pass}`).toString("base64");
    await this.command(`AUTH PLAIN ${payload}`, [235]);
  }

  private command(command: string, expected: number[]) {
    this.write(`${command}\r\n`);
    return this.expect(expected);
  }

  private expect(expected: number[]) {
    return new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = this.pending.indexOf(onLine);

        if (index >= 0) {
          this.pending.splice(index, 1);
        }

        reject(new Error(`SMTP command timed out waiting for ${expected.join("/")}.`));
      }, this.options.timeoutMs ?? 15_000);

      const onLine = (line: string) => {
        clearTimeout(timeout);
        const code = Number(line.slice(0, 3));

        if (expected.includes(code)) {
          resolve(line);
          return;
        }

        reject(new Error(`SMTP expected ${expected.join("/")} but received: ${line}`));
      };

      this.pending.push(onLine);
    });
  }

  private write(value: string) {
    if (!this.socket) {
      throw new Error("SMTP socket is not connected.");
    }

    this.socket.write(value);
  }

  private onData(chunk: string) {
    this.buffer += chunk;
    const lines = this.buffer.split(/\r?\n/);
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      if (/^\d{3}\s/.test(line)) {
        const pending = this.pending.shift();
        pending?.(line);
      }
    }
  }
}

async function buildMimeMessage(message: EmailMessage, defaults: SmtpProviderOptions["defaults"]) {
  const headers: Record<string, string> = {
    From: formatAddress(message.from),
    To: formatAddresses(message.to).join(", "),
    Subject: message.subject,
    Date: new Date().toUTCString(),
    "Message-ID": `<${message.idempotencyKey ?? randomUUID()}@email-sdk.local>`,
    "MIME-Version": "1.0",
    ...headersToObject(message.headers),
  };

  if (message.cc) headers.Cc = formatAddresses(message.cc).join(", ");
  if (message.replyTo ?? defaults?.replyTo) {
    headers["Reply-To"] = message.replyTo
      ? formatAddresses(message.replyTo).join(", ")
      : (defaults?.replyTo ?? "");
  }

  const headerText = Object.entries(headers)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}: ${foldHeader(value)}`)
    .join("\r\n");

  const bodyPart = buildBodyPart(message);

  if (!message.attachments?.length) {
    return `${headerText}\r\n${bodyPart}`;
  }

  const boundary = `email-sdk-mixed-${randomUUID()}`;
  const attachmentParts = await Promise.all(message.attachments.map(buildAttachmentPart));
  const parts = [bodyPart, ...attachmentParts]
    .map((part) => `--${boundary}\r\n${part}`)
    .join("\r\n");

  return `${headerText}\r\nContent-Type: multipart/mixed; boundary="${boundary}"\r\n\r\n${parts}\r\n--${boundary}--`;
}

function buildBodyPart(message: EmailMessage) {
  if (message.html && message.text) {
    const boundary = `email-sdk-alt-${randomUUID()}`;

    return `Content-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message.text}\r\n--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${message.html}\r\n--${boundary}--`;
  }

  const contentType = message.html ? "text/html" : "text/plain";
  const body = message.html ?? message.text ?? "";

  return `Content-Type: ${contentType}; charset=utf-8\r\n\r\n${body}`;
}

async function buildAttachmentPart(attachment: EmailAttachment) {
  const contentType = attachment.contentType ?? "application/octet-stream";
  const disposition = attachment.disposition ?? "attachment";
  const headers = [
    `Content-Type: ${contentType}; name="${attachment.filename}"`,
    "Content-Transfer-Encoding: base64",
    `Content-Disposition: ${disposition}; filename="${attachment.filename}"`,
  ];

  if (attachment.contentId) {
    headers.push(`Content-ID: <${attachment.contentId}>`);
  }

  const encoded = (await attachmentToBytes(attachment)).toString("base64");

  return `${headers.join("\r\n")}\r\n\r\n${wrapBase64(encoded)}`;
}

// Envelope addresses are interpolated into MAIL FROM/RCPT TO commands. RFC 5321
// envelopes only allow printable US-ASCII, so reject whitespace (including
// CR/LF), control characters (including DEL), angle brackets, and non-ASCII
// characters before connecting.
// oxlint-disable-next-line no-control-regex -- control characters are the point
const SMTP_FORBIDDEN_ENVELOPE = /[\x00-\x20<>\x7f-\uffff]/;

// RFC 5322 header field names: printable US-ASCII (0x21-0x7e) excluding the
// colon (0x3a). A name containing CR/LF would terminate the header and inject more.
const SMTP_HEADER_NAME = /^[!-9;-~]+$/;
const SMTP_ATTACHMENT_FILENAME = /^[\x20-\x21\x23-\x5b\x5d-\x7e]+$/;
const SMTP_ATTACHMENT_CONTENT_ID = /^[\x21-\x7e]+$/;
const SMTP_ATTACHMENT_CONTENT_TYPE =
  /^[A-Za-z0-9!#$%&'*+.^_`{|}~-]+\/[A-Za-z0-9!#$%&'*+.^_`{|}~-]+$/;

function assertSmtpMessage(message: EmailMessage) {
  const addresses = [
    formatAddress(message.from),
    ...formatAddresses(message.to),
    ...formatAddresses(message.cc),
    ...formatAddresses(message.bcc),
  ];

  for (const address of addresses) {
    const envelope = parseEmailAddress(address);

    if (envelope.length === 0 || SMTP_FORBIDDEN_ENVELOPE.test(envelope)) {
      throw new EmailValidationError(
        `SMTP envelope address ${JSON.stringify(envelope)} contains invalid characters.`,
        { adapter: "smtp", address: envelope },
      );
    }
  }

  for (const header of headersToArray(message.headers) ?? []) {
    if (!SMTP_HEADER_NAME.test(header.name)) {
      throw new EmailValidationError(
        `SMTP header name ${JSON.stringify(header.name)} contains invalid characters.`,
        { adapter: "smtp", header: header.name },
      );
    }
  }

  for (const attachment of message.attachments ?? []) {
    assertSmtpAttachment(attachment);
  }
}

function assertSmtpAttachment(attachment: EmailAttachment) {
  if (
    typeof attachment.filename !== "string" ||
    !SMTP_ATTACHMENT_FILENAME.test(attachment.filename)
  ) {
    throw new EmailValidationError(
      `SMTP attachment filename ${JSON.stringify(attachment.filename)} contains invalid characters.`,
      { adapter: "smtp", field: "attachments.filename", filename: attachment.filename },
    );
  }

  if (
    attachment.contentType !== undefined &&
    (typeof attachment.contentType !== "string" ||
      !SMTP_ATTACHMENT_CONTENT_TYPE.test(attachment.contentType))
  ) {
    throw new EmailValidationError(
      `SMTP attachment content type ${JSON.stringify(attachment.contentType)} contains invalid characters.`,
      { adapter: "smtp", field: "attachments.contentType", contentType: attachment.contentType },
    );
  }

  if (
    attachment.contentId !== undefined &&
    (typeof attachment.contentId !== "string" ||
      !SMTP_ATTACHMENT_CONTENT_ID.test(attachment.contentId) ||
      /[\s<>]/.test(attachment.contentId))
  ) {
    throw new EmailValidationError(
      `SMTP attachment content ID ${JSON.stringify(attachment.contentId)} contains invalid characters.`,
      { adapter: "smtp", field: "attachments.contentId", contentId: attachment.contentId },
    );
  }

  if (
    attachment.disposition !== undefined &&
    attachment.disposition !== "attachment" &&
    attachment.disposition !== "inline"
  ) {
    throw new EmailValidationError(
      `SMTP attachment disposition ${JSON.stringify(attachment.disposition)} contains invalid characters.`,
      { adapter: "smtp", field: "attachments.disposition", disposition: attachment.disposition },
    );
  }
}

function envelopeAddress(address: EmailAddress) {
  return parseEmailAddress(formatAddress(address));
}

function parseEmailAddress(address: string) {
  const match = address.match(/<([^>]+)>/);
  return (match?.[1] ?? address).trim();
}

function escapeData(value: string) {
  return value.replace(/^\./gm, "..");
}

function foldHeader(value: string) {
  return value.replace(/\r\n|[\r\n]/g, " ");
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

function extractSmtpMessageId(response: string) {
  const match = response.match(/(?:queued as|id)\s+<?([^>\s]+)>?/i);
  return match?.[1];
}
