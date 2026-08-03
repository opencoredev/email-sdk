"use node";

import {
  createEmailClient,
  type EmailAdapter,
  type EmailAttachment,
  type EmailHeader,
  type EmailMessage,
} from "@opencoredev/email-sdk";
import { brevo } from "@opencoredev/email-sdk/brevo";
import { cloudflare } from "@opencoredev/email-sdk/cloudflare";
import { iterable } from "@opencoredev/email-sdk/iterable";
import { jetemail } from "@opencoredev/email-sdk/jetemail";
import { lettermint } from "@opencoredev/email-sdk/lettermint";
import { loops } from "@opencoredev/email-sdk/loops";
import { mailchimp } from "@opencoredev/email-sdk/mailchimp";
import { mailersend } from "@opencoredev/email-sdk/mailersend";
import { mailgun } from "@opencoredev/email-sdk/mailgun";
import { mailpace } from "@opencoredev/email-sdk/mailpace";
import { mailtrap } from "@opencoredev/email-sdk/mailtrap";
import { plunk } from "@opencoredev/email-sdk/plunk";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";
import { defaultsPlugin } from "@opencoredev/email-sdk/plugins/defaults";
import { observabilityPlugin } from "@opencoredev/email-sdk/plugins/observability";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { primitive } from "@opencoredev/email-sdk/primitive";
import { resend } from "@opencoredev/email-sdk/resend";
import { scaleway } from "@opencoredev/email-sdk/scaleway";
import { sequenzy } from "@opencoredev/email-sdk/sequenzy";
import { sendgrid } from "@opencoredev/email-sdk/sendgrid";
import { ses } from "@opencoredev/email-sdk/ses";
import { smtp } from "@opencoredev/email-sdk/smtp";
import { sparkpost } from "@opencoredev/email-sdk/sparkpost";
import { unosend } from "@opencoredev/email-sdk/unosend";
import { zeptomail } from "@opencoredev/email-sdk/zeptomail";

import { env, type Env } from "./_generated/server.js";
import {
  adapterFields,
  type ConvexAdapterField,
  type ConvexEmailEnvVar,
} from "../shared/adapters.js";
import type {
  ConvexEmailAdapterConfig,
  ConvexEmailAdapterKind,
  ConvexEmailAttachment,
  ConvexEmailMessage,
} from "../shared/types.js";

export type BuildEmailClientOptions = {
  adapters: ConvexEmailAdapterConfig[];
  defaultAdapter?: string;
  fallbackAdapters?: string[];
  log?: (event: unknown) => void;
  recordAttempt?: (event: { adapter: string; attempt: number }) => void | Promise<void>;
};

export function buildEmailClient(options: BuildEmailClientOptions) {
  const adapters = options.adapters.map((adapter) => buildAdapter(adapter));
  const defaultAdapter = options.defaultAdapter ?? adapters[0]?.name;

  return createEmailClient({
    adapters,
    defaultAdapter,
    fallback: options.fallbackAdapters
      ? { adapters: options.fallbackAdapters, onUnknownDelivery: "stop" }
      : undefined,
    hooks: options.recordAttempt
      ? {
          async beforeSend(event) {
            await options.recordAttempt?.({ adapter: event.adapter, attempt: event.attempt });
          },
        }
      : undefined,
    plugins: [
      defaultsPlugin({
        sendMetadata: {
          service: "convex-email",
        },
      }),
      observabilityPlugin({
        log(event) {
          options.log?.(event);
        },
      }),
    ],
  });
}

type ResolvedAdapterOptions = Record<string, unknown>;

type AdapterFactory = (
  options: ResolvedAdapterOptions,
  config: ConvexEmailAdapterConfig,
) => EmailAdapter;

/**
 * Wraps an Email SDK adapter whose option keys match its registry field names one-to-one, which
 * is every adapter that does not need option reshaping.
 */
function fromOptions<TOptions>(create: (options: TOptions) => EmailAdapter): AdapterFactory {
  return (options) => create(options as TOptions);
}

/**
 * The only place an adapter constructor is named. Field names, defaults, and the wire format all
 * come from `CONVEX_EMAIL_ADAPTERS`; this map just says which factory receives them.
 */
const ADAPTER_FACTORIES: Record<ConvexEmailAdapterKind, AdapterFactory> = {
  memory: (_options, config) => memoryAdapter(config.name ?? "memory"),
  brevo: fromOptions(brevo),
  cloudflare: fromOptions(cloudflare),
  iterable: fromOptions(iterable),
  jetemail: fromOptions(jetemail),
  lettermint: fromOptions(lettermint),
  loops: fromOptions(loops),
  mailchimp: fromOptions(mailchimp),
  mailersend: fromOptions(mailersend),
  mailgun: fromOptions(mailgun),
  mailpace: fromOptions(mailpace),
  mailtrap: fromOptions(mailtrap),
  plunk: fromOptions(plunk),
  postmark: fromOptions(postmark),
  primitive: fromOptions(primitive),
  resend: fromOptions(resend),
  scaleway: fromOptions(scaleway),
  sendgrid: fromOptions(sendgrid),
  sequenzy: fromOptions(sequenzy),
  ses: fromOptions(ses),
  // SMTP is the one reshaped adapter: credentials resolve as flat fields but nest under `auth`.
  smtp: (options, config) => {
    const resolved = options as {
      host: string;
      port?: number;
      secure?: boolean;
      user?: string;
      pass?: string;
    };

    return smtp({
      name: config.name,
      host: resolved.host,
      port: resolved.port,
      secure: resolved.secure,
      auth:
        resolved.user && resolved.pass ? { user: resolved.user, pass: resolved.pass } : undefined,
    });
  },
  sparkpost: fromOptions(sparkpost),
  unosend: fromOptions(unosend),
  zeptomail: fromOptions(zeptomail),
};

function buildAdapter(config: ConvexEmailAdapterConfig): EmailAdapter {
  const factory = ADAPTER_FACTORIES[config.kind];

  if (!factory) {
    throw new Error(`Unknown Convex Email adapter kind "${config.kind}".`);
  }

  return withName(factory(resolveAdapterOptions(config), config), config.name);
}

/**
 * Turns stored adapter config into Email SDK options: inline values win, otherwise the field is
 * read from the component environment under its configured or default variable name.
 */
export function resolveAdapterOptions(config: ConvexEmailAdapterConfig): ResolvedAdapterOptions {
  const fields = adapterFields(config.kind);

  if (!fields) {
    throw new Error(`Unknown Convex Email adapter kind "${config.kind}".`);
  }

  const values = config as unknown as Record<string, unknown>;
  const options: ResolvedAdapterOptions = {};

  for (const [key, field] of Object.entries(fields)) {
    const inline = field.inline ? values[key] : undefined;
    if (inline !== undefined) {
      options[key] = inline;
      continue;
    }

    const name = field.env ? envNameFor(values, key, field.env) : undefined;
    const fromEnv = name ? readEnvField(name, field) : undefined;
    if (fromEnv !== undefined) {
      options[key] = fromEnv;
      continue;
    }

    if (field.required) {
      throw new Error(
        name
          ? `Missing Convex Email component environment variable ${name}.`
          : `Convex Email adapter "${config.kind}" requires "${key}".`,
      );
    }
  }

  return options;
}

function envNameFor(values: Record<string, unknown>, key: string, fallback: string) {
  const override = values[`${key}Env`];
  return typeof override === "string" && override ? override : fallback;
}

function readEnvField(name: string, field: ConvexAdapterField) {
  const value = componentEnv[name];
  if (!value) {
    return undefined;
  }

  switch (field.type) {
    case "number":
      return parseNumberEnv(name, value);
    case "boolean":
      return value === "1" || value.toLowerCase() === "true";
    case "record":
      throw new Error(`Convex environment variable ${name} cannot supply a record value.`);
    default:
      return value;
  }
}

export async function hydrateAttachments(message: ConvexEmailMessage): Promise<EmailMessage> {
  const attachments = message.attachments
    ? await Promise.all(message.attachments.map(hydrateAttachment))
    : undefined;
  const headers = normalizeHeaders(message.headers);
  const { idempotencyKey: _, ...envelope } = message;
  const hydrated = { ...envelope, headers, attachments };

  if (message.html !== undefined) {
    return { ...hydrated, html: message.html };
  }
  if (message.text !== undefined) {
    return { ...hydrated, text: message.text };
  }

  throw new Error("Email message requires `html` or `text` content.");
}

async function hydrateAttachment(attachment: ConvexEmailAttachment): Promise<EmailAttachment> {
  const { url, ...base } = attachment;

  if (attachment.content !== undefined) {
    return { ...base, content: attachment.content };
  }
  if (!url) {
    throw new Error(`Attachment "${attachment.filename}" requires \`content\` or \`url\`.`);
  }

  const safeUrl = safeAttachmentUrl(url, attachment.filename);
  const response = await fetch(safeUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch email attachment "${attachment.filename}" from ${url}.`);
  }

  return { ...base, content: await response.arrayBuffer() };
}

function normalizeHeaders(
  headers: ConvexEmailMessage["headers"],
): readonly EmailHeader[] | undefined {
  if (!headers) {
    return undefined;
  }
  if (Array.isArray(headers)) {
    return headers;
  }

  return Object.entries(headers).map(([name, value]) => ({ name, value }));
}

function safeAttachmentUrl(value: string, filename: string) {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(`Attachment "${filename}" has an invalid URL.`);
  }

  if (url.protocol !== "https:") {
    throw new Error(`Attachment "${filename}" URL must use https.`);
  }
  if (url.username || url.password) {
    throw new Error(`Attachment "${filename}" URL cannot include credentials.`);
  }

  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");

  if (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    isIpAddressLiteral(hostname)
  ) {
    throw new Error(`Attachment "${filename}" URL host is not allowed.`);
  }

  return url;
}

function isIpAddressLiteral(hostname: string) {
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":");
}

function withName<TAdapter extends EmailAdapter>(adapter: TAdapter, name: string | undefined) {
  if (!name || name === adapter.name) {
    return adapter;
  }

  return { ...adapter, name };
}

function parseNumberEnv(name: string, value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Convex environment variable ${name} must be a number.`);
  }
  return parsed;
}

const componentEnv: Record<string, string | undefined> = env;

// Compile-time assertion that the component's declared environment (`convex.config.ts`, and the
// `Env` type generated from it) covers every credential the adapter registry can read. Adding an
// adapter without declaring its variables fails the build here instead of at send time.
type AssertNever<T extends never> = T;
export type DeclaredEnvCoversRegistry = AssertNever<Exclude<ConvexEmailEnvVar, keyof Env>>;
