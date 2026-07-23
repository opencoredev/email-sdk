import { randomUUID } from "node:crypto";
import net from "node:net";
import tls from "node:tls";

import { EmailAdapterError } from "./errors.js";
import type { EmailAddress, EmailMessage, EmailAdapter } from "./types.js";
import {
	BUILT_IN_ADAPTER_CAPABILITIES,
	formatAddress,
	formatAddresses,
	headersToArray,
	validateBuiltInAdapter,
} from "./utils.js";

type Socket = net.Socket | tls.TLSSocket;

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
  tls?: tls.ConnectionOptions;
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
		raw: {
			host: options.host,
			port,
		},
		async send(message, context) {
			validateBuiltInAdapter("smtp", message);
			const client = new SmtpClient(options, port, context.idempotencyKey);

      try {
        const response = await client.send(message);

        return {
          adapter: name,
          id: response.messageId,
          accepted: response.accepted,
          rejected: [],
          raw: response,
        };
      } catch (error) {
        throw new EmailAdapterError(error instanceof Error ? error.message : "SMTP send failed.", {
          adapter: name,
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
    private readonly options: SmtpAdapterOptions,
    private readonly port: number,
    private readonly idempotencyKey?: string,
  ) {}

  async send(message: EmailMessage) {
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
    const raw = buildMimeMessage(message, this.options.defaults, this.idempotencyKey);
    const response = await this.command(`${escapeData(raw)}\r\n.`, [250]);
    await this.command("QUIT", [221]).catch(() => undefined);

    return {
      messageId: extractSmtpMessageId(response) ?? this.idempotencyKey,
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

function buildMimeMessage(
  message: EmailMessage,
  defaults: SmtpAdapterOptions["defaults"],
  idempotencyKey?: string,
) {
	const headers: Array<[string, string]> = [
		["From", formatAddress(message.from)],
		["To", formatAddresses(message.to).join(", ")],
		["Subject", message.subject],
		["Date", new Date().toUTCString()],
		["Message-ID", `<${idempotencyKey ?? randomUUID()}@email-sdk.local>`],
		["MIME-Version", "1.0"],
		...(headersToArray(message.headers)?.map((header) => [header.name, header.value] as [string, string]) ?? []),
	];

	if (message.cc) headers.push(["Cc", formatAddresses(message.cc).join(", ")]);
	if (message.replyTo ?? defaults?.replyTo) {
		headers.push([
			"Reply-To",
			message.replyTo ? formatAddresses(message.replyTo).join(", ") : (defaults?.replyTo ?? ""),
		]);
	}

	const headerText = headers
		.filter(([, value]) => value)
		.map(([key, value]) => `${key}: ${foldHeader(value)}`)
    .join("\r\n");

  if (message.html && message.text) {
    const boundary = `email-sdk-${randomUUID()}`;

    return `${headerText}\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\n\r\n--${boundary}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${message.text}\r\n--${boundary}\r\nContent-Type: text/html; charset=utf-8\r\n\r\n${message.html}\r\n--${boundary}--`;
  }

  const contentType = message.html ? "text/html" : "text/plain";
  const body = message.html ?? message.text ?? "";

  return `${headerText}\r\nContent-Type: ${contentType}; charset=utf-8\r\n\r\n${body}`;
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

function extractSmtpMessageId(response: string) {
  const match = response.match(/(?:queued as|id)\s+<?([^>\s]+)>?/i);
  return match?.[1];
}
