"use node";

import {
  createEmailClient,
  type EmailAdapter,
  type EmailHeader,
  type EmailMessage,
} from "@opencoredev/email-sdk";
import { brevo } from "@opencoredev/email-sdk/brevo";
import { cloudflare } from "@opencoredev/email-sdk/cloudflare";
import { graph } from "@opencoredev/email-sdk/graph";
import { iterable } from "@opencoredev/email-sdk/iterable";
import { helo } from "@opencoredev/email-sdk/helo";
import { jetemail } from "@opencoredev/email-sdk/jetemail";
import { lettermint } from "@opencoredev/email-sdk/lettermint";
import { lettr } from "@opencoredev/email-sdk/lettr";
import { loops } from "@opencoredev/email-sdk/loops";
import { mailchimp } from "@opencoredev/email-sdk/mailchimp";
import { mailersend } from "@opencoredev/email-sdk/mailersend";
import { mailgun } from "@opencoredev/email-sdk/mailgun";
import { mailpace } from "@opencoredev/email-sdk/mailpace";
import { mailtrap } from "@opencoredev/email-sdk/mailtrap";
import { plunk } from "@opencoredev/email-sdk/plunk";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";
import { defaultsPlugin } from "@opencoredev/email-sdk/plugins/defaults";
import {
  observabilityPlugin,
  type EmailObservabilityEvent,
} from "@opencoredev/email-sdk/plugins/observability";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { primitive } from "@opencoredev/email-sdk/primitive";
import { resend } from "@opencoredev/email-sdk/resend";
import { scaleway } from "@opencoredev/email-sdk/scaleway";
import { sequenzy } from "@opencoredev/email-sdk/sequenzy";
import { sendgrid } from "@opencoredev/email-sdk/sendgrid";
import { sendheron } from "@opencoredev/email-sdk/sendheron";
import { ses } from "@opencoredev/email-sdk/ses";
import { smtp } from "@opencoredev/email-sdk/smtp";
import { sparkpost } from "@opencoredev/email-sdk/sparkpost";
import { unosend } from "@opencoredev/email-sdk/unosend";
import { zeptomail } from "@opencoredev/email-sdk/zeptomail";
import { z } from "zod";

import { env, type Env } from "./_generated/server.js";
import { hydrateAttachment, type AttachmentFetchOptions } from "./attachments.js";
import {
  adapterFields,
  CONVEX_EMAIL_ADAPTER_KINDS,
  isDeclaredEnvVar,
  type ConvexAdapterField,
  type ConvexEmailEnvVar,
} from "../shared/adapters.js";
import type {
  ConvexEmailAdapterConfig,
  ConvexEmailAdapterKind,
  ConvexEmailMessage,
  ConvexEmailMetadataValue,
} from "../shared/types.js";

export type BuildEmailClientOptions = {
  adapters: ConvexEmailAdapterConfig[];
  defaultAdapter?: string;
  fallbackAdapters?: string[];
  log?: (event: EmailObservabilityEvent) => void;
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

/** Any value an adapter config field can hold, inline or parsed from the environment. */
type AdapterOptionValue = string | number | boolean | Readonly<Record<string, ConvexEmailMetadataValue>>;

/** Email SDK adapter options keyed by registry field name. */
type ResolvedAdapterOptions = Record<string, AdapterOptionValue>;

type AdapterFactory = (
  options: ResolvedAdapterOptions,
  config: ConvexEmailAdapterConfig,
) => EmailAdapter;

/**
 * Wraps an Email SDK adapter whose option keys match its registry field names one-to-one, which
 * is every adapter that does not need option reshaping.
 */
function fromOptions<TOptions>(create: (options: TOptions) => EmailAdapter): AdapterFactory {
  // SAFETY: resolveAdapterOptions only emits keys declared for this adapter in
  // CONVEX_EMAIL_ADAPTERS, typed by each field's `type`, and throws when a `required` field is
  // missing. The registry mirrors each Email SDK adapter's option names and value types, which
  // adapters.test.ts exercises by constructing every adapter from resolved options.
  return (options) => create(options as TOptions);
}

const smtpOptions = z.object({
  host: z.string(),
  port: z.number().optional(),
  secure: z.boolean().optional(),
  user: z.string().optional(),
  pass: z.string().optional(),
});

/**
 * The only place an adapter constructor is named. Field names, defaults, and the wire format all
 * come from `CONVEX_EMAIL_ADAPTERS`; this map just says which factory receives them.
 */
const ADAPTER_FACTORIES: Record<ConvexEmailAdapterKind, AdapterFactory> = {
  memory: (_options, config) => memoryAdapter(config.name ?? "memory"),
  brevo: fromOptions(brevo),
  cloudflare: fromOptions(cloudflare),
  helo: fromOptions(helo),
  iterable: fromOptions(iterable),
  jetemail: fromOptions(jetemail),
  lettermint: fromOptions(lettermint),
  lettr: fromOptions(lettr),
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
  sendheron: fromOptions(sendheron),
  sequenzy: fromOptions(sequenzy),
  ses: fromOptions(ses),
  // SMTP is the one reshaped adapter: credentials resolve as flat fields but nest under `auth`.
  smtp: (options, config) => {
    const resolved = smtpOptions.parse(options);

    return smtp({
      name: config.name,
      host: resolved.host,
      port: resolved.port,
      secure: resolved.secure,
      auth:
        resolved.user && resolved.pass ? { user: resolved.user, pass: resolved.pass } : undefined,
    });
  },
  graph: fromOptions(graph),
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
export function resolveAdapterOptions(config: ConvexEmailAdapterConfig) {
  const fields = adapterFields(config.kind);

  if (!fields) {
    throw new Error(`Unknown Convex Email adapter kind "${config.kind}".`);
  }

  const values = new Map<string, AdapterConfigValue>(Object.entries(config));
  const options = new Map<string, AdapterOptionValue>();

  for (const [key, field] of Object.entries(fields)) {
    const inline = field.inline ? values.get(key) : undefined;

    if (inline !== undefined) {
      options.set(key, inline);
      continue;
    }

    const name = field.env ? envNameFor(config.kind, values, key, field.env) : undefined;
    const fromEnv = name ? readEnvField(name, field) : undefined;

    if (fromEnv !== undefined) {
      options.set(key, fromEnv);
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

  return Object.fromEntries(options);
}

/** Every value type a stored adapter config can carry, across all adapter kinds. */
type AdapterConfigValue = AdapterOptionValue | undefined;

const envOverride = z.string().min(1).optional().catch(undefined);

function envNameFor(
  kind: string,
  values: ReadonlyMap<string, AdapterConfigValue>,
  key: string,
  fallback: string,
) {
  const override = envOverride.parse(values.get(`${key}Env`));

  if (override === undefined) {
    return fallback;
  }

  // Graph URL and identity fields must not turn unrelated secrets into request URLs.
  if (kind === "graph" && override !== fallback) {
    throw new Error(`Graph ${key}Env must use ${fallback}; map custom values in app.use(convexEmail, { env }).`);
  }

  // A deployed component only receives the variables its contract declares, so an override
  // naming anything else would resolve to nothing. Fail with the mapping that does work.
  if (!isDeclaredEnvVar(override)) {
    throw new Error(
      `Convex Email adapter "${kind}" cannot read environment variable ${override}: a Convex ` +
        `component only receives the variables declared in its contract, so ${key}Env must name ` +
        `one of them (default ${fallback}). To use a different secret, map it onto ${fallback} ` +
        `in app.use(convexEmail, { env }).`,
    );
  }

  for (const ownerKind of CONVEX_EMAIL_ADAPTER_KINDS) {
    for (const [ownerKey, field] of Object.entries(adapterFields(ownerKind) ?? {})) {
      if (field.env === override && field.restrictEnvToField &&
        (kind !== ownerKind || key !== ownerKey)) {
        throw new Error(`Convex environment variable ${override} is restricted to ${ownerKind}.${ownerKey}.`);
      }
    }
  }

  return override;
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

export async function hydrateAttachments(
  message: ConvexEmailMessage,
  options: AttachmentFetchOptions = {},
): Promise<EmailMessage> {
  const attachments = message.attachments
    ? await Promise.all(
        message.attachments.map((attachment) => hydrateAttachment(attachment, options)),
      )
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
