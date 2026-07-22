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
import { resend } from "@opencoredev/email-sdk/resend";
import { scaleway } from "@opencoredev/email-sdk/scaleway";
import { sequenzy } from "@opencoredev/email-sdk/sequenzy";
import { sendgrid } from "@opencoredev/email-sdk/sendgrid";
import { ses } from "@opencoredev/email-sdk/ses";
import { smtp } from "@opencoredev/email-sdk/smtp";
import { sparkpost } from "@opencoredev/email-sdk/sparkpost";
import { unosend } from "@opencoredev/email-sdk/unosend";
import { zeptomail } from "@opencoredev/email-sdk/zeptomail";

import { env } from "./_generated/server.js";
import type {
  ConvexEmailAdapterConfig,
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

function buildAdapter(config: ConvexEmailAdapterConfig): EmailAdapter {
  switch (config.kind) {
    case "memory": {
      return memoryAdapter(config.name ?? "memory");
    }
    case "brevo": {
      return withName(
        brevo({
          apiKey: requiredEnv(config.apiKeyEnv ?? "BREVO_API_KEY"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "cloudflare": {
      return withName(
        cloudflare({
          apiToken: requiredEnv(config.apiTokenEnv ?? "CLOUDFLARE_API_TOKEN"),
          accountId: config.accountId ?? requiredEnv(config.accountIdEnv ?? "CLOUDFLARE_ACCOUNT_ID"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "iterable": {
      return withName(
        iterable({
          apiKey: requiredEnv(config.apiKeyEnv ?? "ITERABLE_API_KEY"),
          campaignId: config.campaignId ?? requiredNumberEnv(config.campaignIdEnv ?? "ITERABLE_CAMPAIGN_ID"),
          allowRepeatMarketingSends: config.allowRepeatMarketingSends,
          dataFields: config.dataFields,
          sendAt: config.sendAt,
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "loops": {
      return withName(
        loops({
          apiKey: requiredEnv(config.apiKeyEnv ?? "LOOPS_API_KEY"),
          transactionalId:
            config.transactionalId ?? requiredEnv(config.transactionalIdEnv ?? "LOOPS_TRANSACTIONAL_ID"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "mailchimp": {
      return withName(
        mailchimp({
          apiKey: requiredEnv(config.apiKeyEnv ?? "MAILCHIMP_API_KEY"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "mailersend": {
      return withName(
        mailersend({
          apiKey: requiredEnv(config.apiKeyEnv ?? "MAILERSEND_API_KEY"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "mailgun": {
      return withName(
        mailgun({
          apiKey: requiredEnv(config.apiKeyEnv ?? "MAILGUN_API_KEY"),
          domain: config.domain ?? requiredEnv(config.domainEnv ?? "MAILGUN_DOMAIN"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "mailpace": {
      return withName(
        mailpace({
          apiKey: requiredEnv(config.apiKeyEnv ?? "MAILPACE_API_KEY"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "mailtrap": {
      return withName(
        mailtrap({
          apiKey: requiredEnv(config.apiKeyEnv ?? "MAILTRAP_API_KEY"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "plunk": {
      return withName(
        plunk({
          apiKey: requiredEnv(config.apiKeyEnv ?? "PLUNK_API_KEY"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "resend": {
      return withName(
        resend({
          apiKey: requiredEnv(config.apiKeyEnv ?? "RESEND_API_KEY"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "postmark": {
      return withName(
        postmark({
          serverToken: requiredEnv(config.serverTokenEnv ?? "POSTMARK_SERVER_TOKEN"),
          messageStream: config.messageStream,
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "sendgrid": {
      return withName(
        sendgrid({
          apiKey: requiredEnv(config.apiKeyEnv ?? "SENDGRID_API_KEY"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "ses": {
      return withName(
        ses({
          accessKeyId: requiredEnv(config.accessKeyIdEnv ?? "AWS_ACCESS_KEY_ID"),
          secretAccessKey: requiredEnv(config.secretAccessKeyEnv ?? "AWS_SECRET_ACCESS_KEY"),
          sessionToken: optionalEnv(config.sessionTokenEnv ?? "AWS_SESSION_TOKEN"),
          region: config.region ?? requiredEnv(config.regionEnv ?? "AWS_REGION"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "scaleway": {
      return withName(
        scaleway({
          secretKey: requiredEnv(config.secretKeyEnv ?? "SCALEWAY_SECRET_KEY"),
          projectId: config.projectId ?? requiredEnv(config.projectIdEnv ?? "SCALEWAY_PROJECT_ID"),
          region: config.region ?? optionalEnv(config.regionEnv ?? "SCALEWAY_REGION"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "sequenzy": {
      return withName(
        sequenzy({
          apiKey: requiredEnv(config.apiKeyEnv ?? "SEQUENZY_API_KEY"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "smtp": {
      const user = optionalEnv(config.userEnv ?? "SMTP_USER");
      const pass = optionalEnv(config.passEnv ?? "SMTP_PASS");

      return smtp({
        name: config.name,
        host: config.host ?? requiredEnv(config.hostEnv ?? "SMTP_HOST"),
        port: config.port ?? numberEnv(config.portEnv ?? "SMTP_PORT"),
        secure: config.secure ?? booleanEnv(config.secureEnv ?? "SMTP_SECURE"),
        auth: user && pass ? { user, pass } : undefined,
      });
    }
    case "sparkpost": {
      return withName(
        sparkpost({
          apiKey: requiredEnv(config.apiKeyEnv ?? "SPARKPOST_API_KEY"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "unosend": {
      return withName(
        unosend({
          apiKey: requiredEnv(config.apiKeyEnv ?? "UNOSEND_API_KEY"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
    case "zeptomail": {
      return withName(
        zeptomail({
          token: requiredEnv(config.tokenEnv ?? "ZEPTOMAIL_TOKEN"),
          baseUrl: config.baseUrl,
        }),
        config.name,
      );
    }
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

function requiredEnv(name: string) {
  const value = componentEnv[name];
  if (!value) {
    throw new Error(`Missing Convex Email component environment variable ${name}.`);
  }
  return value;
}

function optionalEnv(name: string) {
  return componentEnv[name] || undefined;
}

function numberEnv(name: string) {
  const value = componentEnv[name];
  if (!value) {
    return undefined;
  }

  return parseNumberEnv(name, value);
}

function requiredNumberEnv(name: string) {
  return parseNumberEnv(name, requiredEnv(name));
}

function parseNumberEnv(name: string, value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Convex environment variable ${name} must be a number.`);
  }
  return parsed;
}

function booleanEnv(name: string) {
  const value = componentEnv[name];
  if (!value) {
    return undefined;
  }
  return value === "1" || value.toLowerCase() === "true";
}

const componentEnv: Record<string, string | undefined> = env;
