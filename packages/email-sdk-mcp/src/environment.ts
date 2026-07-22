import { createEmailClient, type EmailAdapter } from "@opencoredev/email-sdk";
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
import { postmark } from "@opencoredev/email-sdk/postmark";
import { primitive } from "@opencoredev/email-sdk/primitive";
import { resend } from "@opencoredev/email-sdk/resend";
import { scaleway } from "@opencoredev/email-sdk/scaleway";
import { sendgrid } from "@opencoredev/email-sdk/sendgrid";
import { sequenzy } from "@opencoredev/email-sdk/sequenzy";
import { ses } from "@opencoredev/email-sdk/ses";
import { smtp } from "@opencoredev/email-sdk/smtp";
import { sparkpost } from "@opencoredev/email-sdk/sparkpost";
import { unosend } from "@opencoredev/email-sdk/unosend";
import { zeptomail } from "@opencoredev/email-sdk/zeptomail";

import type { EmailMcpPolicyOptions, EmailMcpServerOptions } from "./types.js";

type Env = Readonly<Record<string, string | undefined>>;
type AdapterDefinition = {
  requiredEnvironment: readonly string[];
  create(env: Env): EmailAdapter;
};

const adapters = {
  resend: definition(["RESEND_API_KEY"], (env) => resend({ apiKey: required(env, "RESEND_API_KEY") })),
  postmark: definition(["POSTMARK_SERVER_TOKEN"], (env) =>
    postmark({
      serverToken: required(env, "POSTMARK_SERVER_TOKEN"),
      messageStream: env.POSTMARK_MESSAGE_STREAM,
    }),
  ),
  sendgrid: definition(["SENDGRID_API_KEY"], (env) =>
    sendgrid({ apiKey: required(env, "SENDGRID_API_KEY") }),
  ),
  cloudflare: definition(["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"], (env) =>
    cloudflare({
      apiToken: required(env, "CLOUDFLARE_API_TOKEN"),
      accountId: required(env, "CLOUDFLARE_ACCOUNT_ID"),
    }),
  ),
  unosend: definition(["UNOSEND_API_KEY"], (env) =>
    unosend({ apiKey: required(env, "UNOSEND_API_KEY") }),
  ),
  iterable: definition(["ITERABLE_API_KEY", "ITERABLE_CAMPAIGN_ID"], (env) =>
    iterable({
      apiKey: required(env, "ITERABLE_API_KEY"),
      campaignId: requiredInteger(env, "ITERABLE_CAMPAIGN_ID"),
      allowRepeatMarketingSends: false,
    }),
  ),
  ses: definition(["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"], (env) =>
    ses({
      accessKeyId: required(env, "AWS_ACCESS_KEY_ID"),
      secretAccessKey: required(env, "AWS_SECRET_ACCESS_KEY"),
      region: required(env, "AWS_REGION"),
      sessionToken: env.AWS_SESSION_TOKEN,
      configurationSetName: env.AWS_SES_CONFIGURATION_SET,
    }),
  ),
  mailgun: definition(["MAILGUN_API_KEY", "MAILGUN_DOMAIN"], (env) =>
    mailgun({
      apiKey: required(env, "MAILGUN_API_KEY"),
      domain: required(env, "MAILGUN_DOMAIN"),
    }),
  ),
  mailersend: definition(["MAILERSEND_API_KEY"], (env) =>
    mailersend({ apiKey: required(env, "MAILERSEND_API_KEY") }),
  ),
  brevo: definition(["BREVO_API_KEY"], (env) => brevo({ apiKey: required(env, "BREVO_API_KEY") })),
  mailchimp: definition(["MAILCHIMP_API_KEY"], (env) =>
    mailchimp({ apiKey: required(env, "MAILCHIMP_API_KEY") }),
  ),
  sparkpost: definition(["SPARKPOST_API_KEY"], (env) =>
    sparkpost({ apiKey: required(env, "SPARKPOST_API_KEY") }),
  ),
  loops: definition(["LOOPS_API_KEY", "LOOPS_TRANSACTIONAL_ID"], (env) =>
    loops({
      apiKey: required(env, "LOOPS_API_KEY"),
      transactionalId: required(env, "LOOPS_TRANSACTIONAL_ID"),
    }),
  ),
  sequenzy: definition(["SEQUENZY_API_KEY"], (env) =>
    sequenzy({ apiKey: required(env, "SEQUENZY_API_KEY") }),
  ),
  jetemail: definition(["JETEMAIL_API_KEY"], (env) =>
    jetemail({ apiKey: required(env, "JETEMAIL_API_KEY") }),
  ),
  lettermint: definition(["LETTERMINT_API_TOKEN"], (env) =>
    lettermint({
      apiToken: required(env, "LETTERMINT_API_TOKEN"),
      route: env.LETTERMINT_ROUTE,
    }),
  ),
  primitive: definition(["PRIMITIVE_API_KEY"], (env) =>
    primitive({ apiKey: required(env, "PRIMITIVE_API_KEY") }),
  ),
  plunk: definition(["PLUNK_API_KEY"], (env) => plunk({ apiKey: required(env, "PLUNK_API_KEY") })),
  mailtrap: definition(["MAILTRAP_API_KEY"], (env) =>
    mailtrap({ apiKey: required(env, "MAILTRAP_API_KEY") }),
  ),
  scaleway: definition(["SCALEWAY_SECRET_KEY", "SCALEWAY_PROJECT_ID"], (env) =>
    scaleway({
      secretKey: required(env, "SCALEWAY_SECRET_KEY"),
      projectId: required(env, "SCALEWAY_PROJECT_ID"),
      region: env.SCALEWAY_REGION,
    }),
  ),
  zeptomail: definition(["ZEPTOMAIL_TOKEN"], (env) =>
    zeptomail({ token: required(env, "ZEPTOMAIL_TOKEN") }),
  ),
  mailpace: definition(["MAILPACE_API_KEY"], (env) =>
    mailpace({ apiKey: required(env, "MAILPACE_API_KEY") }),
  ),
  smtp: definition(["SMTP_HOST"], (env) =>
    smtp({
      host: required(env, "SMTP_HOST"),
      port: optionalInteger(env, "SMTP_PORT", env.SMTP_SECURE === "true" ? 465 : 587),
      secure: env.SMTP_SECURE === "true",
      requireTLS: true,
      allowInsecureAuth: false,
      auth:
        env.SMTP_USER || env.SMTP_PASS
          ? {
              user: required(env, "SMTP_USER"),
              pass: required(env, "SMTP_PASS"),
            }
          : undefined,
    }),
  ),
} as const satisfies Record<string, AdapterDefinition>;

type AdapterName = keyof typeof adapters;

export class EmailMcpStartupError extends Error {}

export function createEmailMcpOptionsFromEnv(env: Env): EmailMcpServerOptions {
  const adapterName = env.EMAIL_SDK_MCP_ADAPTER?.trim().toLowerCase();

  if (!adapterName) {
    throw new EmailMcpStartupError("EMAIL_SDK_MCP_ADAPTER is required.");
  }

  if (!isAdapterName(adapterName)) {
    throw new EmailMcpStartupError("EMAIL_SDK_MCP_ADAPTER is not supported.");
  }

  const definition = adapters[adapterName];
  const missingEnvironment = [
    ...definition.requiredEnvironment,
    "EMAIL_SDK_MCP_FROM",
    ...smtpAuthEnvironment(adapterName, env),
  ].filter((name) => !env[name]);
  const client =
    missingEnvironment.length === 0
      ? createEmailClient({
          adapters: [definition.create(env)],
          retry: { maxAttempts: 1 },
          telemetry: false,
        })
      : undefined;

  return {
    adapter: adapterName,
    sender: env.EMAIL_SDK_MCP_FROM,
    client,
    sendEnabled: env.EMAIL_SDK_MCP_ENABLE_SEND === "1",
    missingEnvironment,
    policy: policyFromEnv(env),
  };
}

function definition(
  requiredEnvironment: readonly string[],
  create: (env: Env) => EmailAdapter,
): AdapterDefinition {
  return { requiredEnvironment, create };
}

function policyFromEnv(env: Env): EmailMcpPolicyOptions {
  return {
    allowedRecipients: csv(env.EMAIL_SDK_MCP_ALLOWED_RECIPIENTS),
    allowedDomains: csv(env.EMAIL_SDK_MCP_ALLOWED_DOMAINS),
    maxRecipients: optionalPositiveInteger(env, "EMAIL_SDK_MCP_MAX_RECIPIENTS"),
    maxSubjectLength: optionalPositiveInteger(env, "EMAIL_SDK_MCP_MAX_SUBJECT_LENGTH"),
    maxTextLength: optionalPositiveInteger(env, "EMAIL_SDK_MCP_MAX_TEXT_LENGTH"),
    maxHtmlLength: optionalPositiveInteger(env, "EMAIL_SDK_MCP_MAX_HTML_LENGTH"),
    validationTtlMs: optionalPositiveInteger(env, "EMAIL_SDK_MCP_VALIDATION_TTL_MS"),
    maxPendingValidations: optionalPositiveInteger(
      env,
      "EMAIL_SDK_MCP_MAX_PENDING_VALIDATIONS",
    ),
    approvalTimeoutMs: optionalPositiveInteger(env, "EMAIL_SDK_MCP_APPROVAL_TIMEOUT_MS"),
  };
}

function smtpAuthEnvironment(adapterName: AdapterName, env: Env): string[] {
  return adapterName === "smtp" && (env.SMTP_USER || env.SMTP_PASS)
    ? ["SMTP_USER", "SMTP_PASS"]
    : [];
}

function isAdapterName(value: string): value is AdapterName {
  return Object.prototype.hasOwnProperty.call(adapters, value);
}

function required(env: Env, name: string): string {
  const value = env[name];
  if (!value) {
    throw new EmailMcpStartupError(`${name} is required.`);
  }
  return value;
}

function requiredInteger(env: Env, name: string): number {
  const value = Number(required(env, name));
  if (!Number.isSafeInteger(value)) {
    throw new EmailMcpStartupError(`${name} must be an integer.`);
  }
  return value;
}

function optionalInteger(env: Env, name: string, fallback: number): number {
  const raw = env[name];
  if (!raw) {
    return fallback;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new EmailMcpStartupError(`${name} must be an integer.`);
  }
  return value;
}

function optionalPositiveInteger(env: Env, name: string): number | undefined {
  const raw = env[name];
  if (!raw) {
    return undefined;
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EmailMcpStartupError(`${name} must be a positive integer.`);
  }
  return value;
}

function csv(value: string | undefined): string[] | undefined {
  const entries = value?.split(",").map((item) => item.trim()).filter(Boolean);
  return entries && entries.length > 0 ? entries : undefined;
}
