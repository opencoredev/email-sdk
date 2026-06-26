#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { brevo } from "./brevo.js";
import { assertCloudflareMessage, cloudflare } from "./cloudflare.js";
import { createEmailClient } from "./core.js";
import { EmailSdkError } from "./errors.js";
import { iterable } from "./iterable.js";
import { jetemail } from "./jetemail.js";
import { lettermint } from "./lettermint.js";
import { loops } from "./loops.js";
import { mailchimp } from "./mailchimp.js";
import { mailersend } from "./mailersend.js";
import { mailgun } from "./mailgun.js";
import { mailpace } from "./mailpace.js";
import { mailtrap } from "./mailtrap.js";
import { plunk } from "./plunk.js";
import { postmark } from "./postmark.js";
import { primitive } from "./primitive.js";
import { resend } from "./resend.js";
import { scaleway } from "./scaleway.js";
import { sequenzy } from "./sequenzy.js";
import { ses } from "./ses.js";
import { sendgrid } from "./sendgrid.js";
import { smtp } from "./smtp.js";
import { sparkpost } from "./sparkpost.js";
import type {
  EmailAttachment,
  EmailHeader,
  EmailMessage,
  EmailProvider,
  EmailTag,
} from "./types.js";
import {
  SUPPORTED_MESSAGE_FIELDS,
  arrayify,
  assertMaxItems,
  assertMessage,
  assertSupportedMessageFields,
} from "./utils.js";
import { assertUnosendMessage, unosend } from "./unosend.js";
import { zeptomail } from "./zeptomail.js";

type CliFlags = Record<string, string | string[] | true>;
type ProviderFactory = (flags: CliFlags) => EmailProvider;
type SupportedAdapterName = keyof typeof SUPPORTED_MESSAGE_FIELDS;
type PackageInfo = {
  name: string;
  version: string;
};

const providerDocs = [
  { name: "resend", env: ["RESEND_API_KEY"], note: "Resend Email API" },
  { name: "postmark", env: ["POSTMARK_SERVER_TOKEN"], note: "Postmark Email API" },
  { name: "sendgrid", env: ["SENDGRID_API_KEY"], note: "Twilio SendGrid Mail Send API" },
  {
    name: "cloudflare",
    env: ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"],
    note: "Cloudflare Email Sending REST API",
  },
  { name: "unosend", env: ["UNOSEND_API_KEY"], note: "Unosend REST API" },
  {
    name: "iterable",
    env: ["ITERABLE_API_KEY", "ITERABLE_CAMPAIGN_ID"],
    note: "Iterable target email API",
  },
  {
    name: "ses",
    env: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_REGION"],
    note: "AWS SES v2 SendEmail API",
  },
  { name: "mailgun", env: ["MAILGUN_API_KEY", "MAILGUN_DOMAIN"], note: "Mailgun Messages API" },
  { name: "mailersend", env: ["MAILERSEND_API_KEY"], note: "MailerSend Email API" },
  { name: "brevo", env: ["BREVO_API_KEY"], note: "Brevo transactional email API" },
  { name: "mailchimp", env: ["MAILCHIMP_API_KEY"], note: "Mailchimp Transactional" },
  { name: "sparkpost", env: ["SPARKPOST_API_KEY"], note: "SparkPost Transmissions API" },
  {
    name: "loops",
    env: ["LOOPS_API_KEY", "LOOPS_TRANSACTIONAL_ID"],
    note: "Loops transactional email",
  },
  { name: "sequenzy", env: ["SEQUENZY_API_KEY"], note: "Sequenzy transactional email API" },
  { name: "jetemail", env: ["JETEMAIL_API_KEY"], note: "JetEmail transactional email API" },
  { name: "lettermint", env: ["LETTERMINT_API_TOKEN"], note: "Lettermint sending API" },
  { name: "primitive", env: ["PRIMITIVE_API_KEY"], note: "Primitive email API for AI agents" },
  { name: "plunk", env: ["PLUNK_API_KEY"], note: "Plunk public send API" },
  { name: "mailtrap", env: ["MAILTRAP_API_KEY"], note: "Mailtrap Email Sending API" },
  {
    name: "scaleway",
    env: ["SCALEWAY_SECRET_KEY", "SCALEWAY_PROJECT_ID"],
    note: "Scaleway Transactional Email",
  },
  { name: "zeptomail", env: ["ZEPTOMAIL_TOKEN"], note: "Zoho ZeptoMail API" },
  { name: "mailpace", env: ["MAILPACE_API_KEY"], note: "MailPace send API" },
  { name: "smtp", env: ["SMTP_HOST"], note: "Built-in SMTP transport" },
] as const satisfies ReadonlyArray<{
  name: SupportedAdapterName;
  env: readonly string[];
  note: string;
}>;

type ProviderName = (typeof providerDocs)[number]["name"];

const factories = {
  resend: (flags) => resend({ apiKey: flagOrEnv(flags, "api-key", "RESEND_API_KEY") }),
  postmark: (flags) =>
    postmark({
      serverToken: flagOrEnv(flags, "server-token", "POSTMARK_SERVER_TOKEN"),
      messageStream: stringFlag(flags, "message-stream") ?? process.env.POSTMARK_MESSAGE_STREAM,
    }),
  sendgrid: (flags) => sendgrid({ apiKey: flagOrEnv(flags, "api-key", "SENDGRID_API_KEY") }),
  cloudflare: (flags) =>
    cloudflare({
      apiToken: flagOrEnv(flags, "api-token", "CLOUDFLARE_API_TOKEN"),
      accountId: flagOrEnv(flags, "account-id", "CLOUDFLARE_ACCOUNT_ID"),
      baseUrl: stringFlag(flags, "base-url") ?? process.env.CLOUDFLARE_BASE_URL,
    }),
  unosend: (flags) =>
    unosend({
      apiKey: flagOrEnv(flags, "api-key", "UNOSEND_API_KEY"),
      baseUrl: stringFlag(flags, "base-url") ?? process.env.UNOSEND_BASE_URL,
    }),
  iterable: (flags) =>
    iterable({
      apiKey: flagOrEnv(flags, "api-key", "ITERABLE_API_KEY"),
      campaignId: numberFlagOrEnv(flags, "campaign-id", "ITERABLE_CAMPAIGN_ID"),
      baseUrl: stringFlag(flags, "base-url") ?? process.env.ITERABLE_BASE_URL,
      sendAt: stringFlag(flags, "send-at") ?? process.env.ITERABLE_SEND_AT,
      allowRepeatMarketingSends:
        booleanFlag(flags, "allow-repeat-marketing-sends") ??
        booleanEnv("ITERABLE_ALLOW_REPEAT_MARKETING_SENDS"),
    }),
  ses: (flags) =>
    ses({
      accessKeyId: flagOrEnv(flags, "access-key-id", "AWS_ACCESS_KEY_ID"),
      secretAccessKey: flagOrEnv(flags, "secret-access-key", "AWS_SECRET_ACCESS_KEY"),
      sessionToken: stringFlag(flags, "session-token") ?? process.env.AWS_SESSION_TOKEN,
      region: flagOrEnv(flags, "region", "AWS_REGION"),
      baseUrl: stringFlag(flags, "base-url") ?? process.env.AWS_SES_BASE_URL,
      configurationSetName:
        stringFlag(flags, "configuration-set") ?? process.env.AWS_SES_CONFIGURATION_SET,
    }),
  mailgun: (flags) =>
    mailgun({
      apiKey: flagOrEnv(flags, "api-key", "MAILGUN_API_KEY"),
      domain: flagOrEnv(flags, "domain", "MAILGUN_DOMAIN"),
      baseUrl: stringFlag(flags, "base-url") ?? process.env.MAILGUN_BASE_URL,
    }),
  mailersend: (flags) => mailersend({ apiKey: flagOrEnv(flags, "api-key", "MAILERSEND_API_KEY") }),
  brevo: (flags) => brevo({ apiKey: flagOrEnv(flags, "api-key", "BREVO_API_KEY") }),
  mailchimp: (flags) => mailchimp({ apiKey: flagOrEnv(flags, "api-key", "MAILCHIMP_API_KEY") }),
  sparkpost: (flags) => sparkpost({ apiKey: flagOrEnv(flags, "api-key", "SPARKPOST_API_KEY") }),
  loops: (flags) =>
    loops({
      apiKey: flagOrEnv(flags, "api-key", "LOOPS_API_KEY"),
      transactionalId: flagOrEnv(flags, "transactional-id", "LOOPS_TRANSACTIONAL_ID"),
    }),
  sequenzy: (flags) =>
    sequenzy({
      apiKey: flagOrEnv(flags, "api-key", "SEQUENZY_API_KEY"),
      baseUrl: stringFlag(flags, "base-url") ?? process.env.SEQUENZY_BASE_URL,
    }),
  jetemail: (flags) =>
    jetemail({
      apiKey: flagOrEnv(flags, "api-key", "JETEMAIL_API_KEY"),
      baseUrl: stringFlag(flags, "base-url") ?? process.env.JETEMAIL_BASE_URL,
    }),
  lettermint: (flags) =>
    lettermint({
      apiToken: flagOrEnv(flags, "api-token", "LETTERMINT_API_TOKEN"),
      baseUrl: stringFlag(flags, "base-url") ?? process.env.LETTERMINT_BASE_URL,
      route: stringFlag(flags, "route") ?? process.env.LETTERMINT_ROUTE,
    }),
  primitive: (flags) =>
    primitive({
      apiKey: flagOrEnv(flags, "api-key", "PRIMITIVE_API_KEY"),
      baseUrl: stringFlag(flags, "base-url") ?? process.env.PRIMITIVE_BASE_URL,
    }),
  plunk: (flags) => plunk({ apiKey: flagOrEnv(flags, "api-key", "PLUNK_API_KEY") }),
  mailtrap: (flags) => mailtrap({ apiKey: flagOrEnv(flags, "api-key", "MAILTRAP_API_KEY") }),
  scaleway: (flags) =>
    scaleway({
      secretKey: flagOrEnv(flags, "secret-key", "SCALEWAY_SECRET_KEY"),
      projectId: flagOrEnv(flags, "project-id", "SCALEWAY_PROJECT_ID"),
      region: stringFlag(flags, "region") ?? process.env.SCALEWAY_REGION,
    }),
  zeptomail: (flags) => zeptomail({ token: flagOrEnv(flags, "token", "ZEPTOMAIL_TOKEN") }),
  mailpace: (flags) => mailpace({ apiKey: flagOrEnv(flags, "api-key", "MAILPACE_API_KEY") }),
  smtp: (flags) =>
    smtp({
      host: flagOrEnv(flags, "host", "SMTP_HOST"),
      port: Number(stringFlag(flags, "port") ?? process.env.SMTP_PORT ?? 587),
      secure: truthyFlag(flags, "secure") || process.env.SMTP_SECURE === "true",
      requireTLS: truthyFlag(flags, "require-tls") || process.env.SMTP_REQUIRE_TLS === "true",
      allowInsecureAuth:
        truthyFlag(flags, "allow-insecure-auth") || process.env.SMTP_ALLOW_INSECURE_AUTH === "true",
      auth:
        stringFlag(flags, "user") || process.env.SMTP_USER
          ? {
              user: flagOrEnv(flags, "user", "SMTP_USER"),
              pass: flagOrEnv(flags, "pass", "SMTP_PASS"),
            }
          : undefined,
    }),
} satisfies Record<ProviderName, ProviderFactory>;

const envFlagNames: Record<string, string> = {
  RESEND_API_KEY: "api-key",
  POSTMARK_SERVER_TOKEN: "server-token",
  SENDGRID_API_KEY: "api-key",
  CLOUDFLARE_API_TOKEN: "api-token",
  CLOUDFLARE_ACCOUNT_ID: "account-id",
  UNOSEND_API_KEY: "api-key",
  ITERABLE_API_KEY: "api-key",
  ITERABLE_CAMPAIGN_ID: "campaign-id",
  AWS_ACCESS_KEY_ID: "access-key-id",
  AWS_SECRET_ACCESS_KEY: "secret-access-key",
  AWS_REGION: "region",
  MAILGUN_API_KEY: "api-key",
  MAILGUN_DOMAIN: "domain",
  MAILERSEND_API_KEY: "api-key",
  BREVO_API_KEY: "api-key",
  MAILCHIMP_API_KEY: "api-key",
  SPARKPOST_API_KEY: "api-key",
  LOOPS_API_KEY: "api-key",
  LOOPS_TRANSACTIONAL_ID: "transactional-id",
  SEQUENZY_API_KEY: "api-key",
  JETEMAIL_API_KEY: "api-key",
  LETTERMINT_API_TOKEN: "api-token",
  PRIMITIVE_API_KEY: "api-key",
  PLUNK_API_KEY: "api-key",
  MAILTRAP_API_KEY: "api-key",
  SCALEWAY_SECRET_KEY: "secret-key",
  SCALEWAY_PROJECT_ID: "project-id",
  ZEPTOMAIL_TOKEN: "token",
  MAILPACE_API_KEY: "api-key",
  SMTP_HOST: "host",
};

async function main() {
  const [command, ...args] = process.argv.slice(2);
  const flags = parseFlags(args);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    printHelp();
    return;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    await printVersion(flags);
    return;
  }

  if (command === "adapters" || command === "providers") {
    printAdapters(flags);
    return;
  }

  if (command === "doctor") {
    doctor(flags);
    return;
  }

  if (command !== "send") {
    fail(`Unknown command "${command}".`);
  }

  const providerName = selectedAdapter(flags) ?? detectProvider();
  const message = await buildMessage(flags);

  if (truthyFlag(flags, "dry-run")) {
    validateDryRun(providerName, message);
    console.log(
      JSON.stringify(
        {
          ok: true,
          adapter: providerName,
          message: redactMessageForDryRun(message),
        },
        null,
        2,
      ),
    );
    return;
  }

  const provider = createProvider(providerName, flags);
  const client = createEmailClient({ adapters: [provider] });
  const response = await client.send(message);

  console.log(JSON.stringify(response, null, 2));
}

function createProvider(name: string, flags: CliFlags): EmailProvider {
  if (!isProviderName(name)) {
    fail(`Unsupported adapter "${name}". Run \`email-sdk adapters\` to see supported adapters.`);
  }

  return factories[name](flags);
}

function validateDryRun(name: string, message: EmailMessage) {
  if (!isProviderName(name)) {
    fail(`Unsupported adapter "${name}". Run \`email-sdk adapters\` to see supported adapters.`);
  }

  assertMessage(message);
  assertSupportedMessageFields(name, message, SUPPORTED_MESSAGE_FIELDS[name]);

  if (name === "loops") {
    assertMaxItems("loops", "recipient", arrayify(message.to), 1);
  }

  if (name === "iterable") {
    assertMaxItems("iterable", "recipient", arrayify(message.to), 1);
  }

  if (name === "cloudflare") {
    assertCloudflareMessage(message);
  }

  if (name === "unosend") {
    assertUnosendMessage(message);
  }
}

function isProviderName(name: string): name is ProviderName {
  return Object.prototype.hasOwnProperty.call(factories, name);
}

function detectProvider() {
  for (const provider of providerDocs) {
    if (provider.env.every((name) => process.env[name])) {
      return provider.name;
    }
  }

  fail("Pass --adapter or set the required environment for one adapter.");
}

function printAdapters(flags: CliFlags) {
  const json = truthyFlag(flags, "json");

  if (json) {
    console.log(JSON.stringify(providerDocs, null, 2));
    return;
  }

  console.log("Email SDK adapters\n");

  for (const provider of providerDocs) {
    console.log(
      `${provider.name.padEnd(12)} ${provider.env.join(", ").padEnd(42)} ${provider.note}`,
    );
  }
}

function doctor(flags: CliFlags) {
  const providerName = selectedAdapter(flags) ?? detectProvider();
  const provider = providerDocs.find((item) => item.name === providerName);

  if (!provider) {
    fail(`Unsupported adapter "${providerName}".`);
  }

  const missing = provider.env.filter((name) => !hasEnvOrFlag(flags, name));

  if (missing.length > 0) {
    fail(`Missing environment for ${provider.name}: ${missing.join(", ")}`);
  }

  console.log(`${provider.name} looks configured.`);
}

function hasEnvOrFlag(flags: CliFlags, env: string) {
  const flag = envFlagNames[env];
  return Boolean(process.env[env] || (flag ? stringFlag(flags, flag) : undefined));
}

async function printVersion(flags: CliFlags) {
  const packageInfo = await readPackageInfo();

  if (truthyFlag(flags, "json")) {
    console.log(JSON.stringify(packageInfo, null, 2));
    return;
  }

  console.log(`${packageInfo.name} ${packageInfo.version}`);
}

async function readPackageInfo(): Promise<PackageInfo> {
  try {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8"),
    ) as Partial<PackageInfo> | undefined;

    return {
      name: packageJson?.name ?? "@opencoredev/email-sdk",
      version: packageJson?.version ?? "0.0.0",
    };
  } catch {
    return {
      name: "@opencoredev/email-sdk",
      version: "0.0.0",
    };
  }
}

function parseFlags(args: string[]): CliFlags {
  const flags: CliFlags = {};

  for (let index = 0; index < args.length; index += 1) {
    const current = args[index];

    if (!current?.startsWith("--")) {
      continue;
    }

    const [key, inlineValue] = current.slice(2).split(/=(.*)/s);

    if (!key) {
      continue;
    }

    if (inlineValue !== undefined) {
      setFlag(flags, key, inlineValue);
      continue;
    }

    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      setFlag(flags, key, true);
      continue;
    }

    setFlag(flags, key, next);
    index += 1;
  }

  return flags;
}

function setFlag(flags: CliFlags, key: string, value: string | true) {
  const current = flags[key];

  if (current === undefined) {
    flags[key] = value;
    return;
  }

  if (Array.isArray(current)) {
    current.push(String(value));
    return;
  }

  flags[key] = [String(current), String(value)];
}

function requiredFlag(flags: CliFlags, name: string) {
  const value = stringFlag(flags, name);

  if (!value) {
    fail(`Missing --${name}.`);
  }

  return value;
}

function flagOrEnv(flags: CliFlags, flag: string, env: string) {
  const value = stringFlag(flags, flag) ?? process.env[env];

  if (!value) {
    fail(`Missing --${flag} or ${env}.`);
  }

  return value;
}

function numberFlagOrEnv(flags: CliFlags, flag: string, env: string) {
  const raw = flagOrEnv(flags, flag, env);
  const value = Number(raw);

  if (!Number.isFinite(value)) {
    fail(`Invalid --${flag} or ${env}. Expected a number.`);
  }

  return value;
}

function stringFlag(flags: CliFlags, name: string) {
  const value = flags[name];

  if (Array.isArray(value)) {
    return value.at(-1);
  }

  return typeof value === "string" ? value : undefined;
}

function stringFlags(flags: CliFlags, name: string) {
  const value = flags[name];

  if (Array.isArray(value)) {
    return value;
  }

  return typeof value === "string" ? [value] : [];
}

function selectedAdapter(flags: CliFlags) {
  return stringFlag(flags, "adapter") ?? stringFlag(flags, "provider");
}

function truthyFlag(flags: CliFlags, name: string) {
  const value = flags[name];
  return value === true || value === "true" || value === "1";
}

function booleanFlag(flags: CliFlags, name: string) {
  const value = flags[name];

  if (value === undefined) {
    return undefined;
  }

  return value === true || value === "true" || value === "1";
}

function booleanEnv(name: string) {
  const value = process.env[name];

  if (value === undefined) {
    return undefined;
  }

  return value === "true" || value === "1";
}

async function buildMessage(flags: CliFlags): Promise<EmailMessage> {
  const messagePath = stringFlag(flags, "message");
  const fromFile = messagePath
    ? (JSON.parse(await readFile(messagePath, "utf8")) as Partial<EmailMessage>)
    : {};
  const message: Partial<EmailMessage> = { ...fromFile };

  if (stringFlag(flags, "from")) message.from = stringFlag(flags, "from")!;
  if (stringFlag(flags, "to")) message.to = splitAddresses(requiredFlag(flags, "to"));
  if (stringFlag(flags, "subject")) message.subject = stringFlag(flags, "subject")!;
  if (stringFlag(flags, "text")) message.text = stringFlag(flags, "text");
  if (stringFlag(flags, "html")) message.html = stringFlag(flags, "html");
  if (stringFlag(flags, "cc")) message.cc = splitAddresses(requiredFlag(flags, "cc"));
  if (stringFlag(flags, "bcc")) message.bcc = splitAddresses(requiredFlag(flags, "bcc"));
  if (stringFlag(flags, "reply-to"))
    message.replyTo = splitAddresses(requiredFlag(flags, "reply-to"));

  const headers = parseHeaders(stringFlags(flags, "header"));
  if (headers.length > 0) message.headers = headers;

  const tags = parseTags(stringFlags(flags, "tag"));
  if (tags.length > 0) message.tags = tags;

  const metadata = parseMetadata(stringFlags(flags, "metadata"));
  if (Object.keys(metadata).length > 0) message.metadata = metadata;

  const attachments = parseAttachments([
    ...stringFlags(flags, "attachment"),
    ...stringFlags(flags, "attach"),
  ]);
  if (attachments.length > 0) message.attachments = attachments;

  return message as EmailMessage;
}

function splitAddresses(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseHeaders(values: string[]): EmailHeader[] {
  return values.map((value) => {
    const index = value.indexOf(":");

    if (index <= 0) {
      fail(`Invalid --header "${value}". Use "Name: value".`);
    }

    return {
      name: value.slice(0, index).trim(),
      value: value.slice(index + 1).trim(),
    };
  });
}

function parseTags(values: string[]): EmailTag[] {
  return values.map((value) => {
    const [name, tagValue] = splitPair(value, "tag");
    return { name, value: tagValue };
  });
}

function parseMetadata(values: string[]) {
  return Object.fromEntries(values.map((value) => splitPair(value, "metadata")));
}

function splitPair(value: string, flag: string): [string, string] {
  const index = value.indexOf("=");

  if (index <= 0) {
    fail(`Invalid --${flag} "${value}". Use "name=value".`);
  }

  return [value.slice(0, index).trim(), value.slice(index + 1).trim()];
}

function parseAttachments(values: string[]): EmailAttachment[] {
  return values.map((value) => {
    const [path, contentType] = value.split(/:(.*)/s);

    if (!path) {
      fail("Invalid --attachment. Pass a file path.");
    }

    return {
      filename: basename(path),
      path,
      contentType: contentType || undefined,
    };
  });
}

function redactMessageForDryRun(message: EmailMessage) {
  return {
    ...message,
    attachments: message.attachments?.map((attachment) => ({
      filename: attachment.filename,
      path: attachment.path,
      contentType: attachment.contentType,
      contentId: attachment.contentId,
      disposition: attachment.disposition,
    })),
  };
}

function printHelp() {
  console.log(`Email SDK

Usage:
  email-sdk version
  email-sdk adapters
  RESEND_API_KEY="re_..." email-sdk doctor --adapter resend
  email-sdk send --adapter resend --from you@example.com --to them@example.com --subject "Hello" --text "It works"

Send options:
  --adapter <name>             Adapter routing name. Run "email-sdk adapters".
  --provider <name>            Alias for --adapter.
  --from <address>             Sender address.
  --to <addresses>             Comma-separated recipient addresses.
  --subject <subject>          Message subject.
  --text <body>                Plain text body.
  --html <body>                HTML body.
  --cc <addresses>             Comma-separated CC addresses.
  --bcc <addresses>            Comma-separated BCC addresses.
  --reply-to <addresses>       Comma-separated reply-to addresses.
  --header <name:value>        Add a custom header. Repeatable.
  --tag <name=value>           Add a provider tag. Repeatable.
  --metadata <key=value>       Add provider metadata. Repeatable.
  --attachment <path[:type]>   Attach a local file. Repeatable.
  --message <path>             Read the EmailMessage JSON payload from a file.
  --dry-run                    Validate input and print the send plan without sending.
  --base-url <url>             Overrides supported adapter base URL variables.

Cloudflare options:
  --api-token <token>          Overrides CLOUDFLARE_API_TOKEN.
  --account-id <account>       Overrides CLOUDFLARE_ACCOUNT_ID.

Iterable options:
  --campaign-id <id>           Overrides ITERABLE_CAMPAIGN_ID.
  --send-at <utc>              Overrides ITERABLE_SEND_AT.
  --allow-repeat-marketing-sends
                                Allows repeat marketing sends.

SMTP options:
  --host <host>                Overrides SMTP_HOST.
  --port <port>                Overrides SMTP_PORT.
  --secure                     Use TLS from the start.
  --require-tls                Require STARTTLS.
  --allow-insecure-auth        Allow SMTP AUTH without TLS.
  --user <user>                Overrides SMTP_USER.
  --pass <pass>                Overrides SMTP_PASS.
`);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

try {
  await main();
} catch (error) {
  if (error instanceof EmailSdkError) {
    fail(error.message);
  }

  throw error;
}
