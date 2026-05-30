#!/usr/bin/env bun
import "dotenv/config";

import { brevo } from "./brevo.js";
import { createEmailClient } from "./core.js";
import { loops } from "./loops.js";
import { mailchimp } from "./mailchimp.js";
import { mailersend } from "./mailersend.js";
import { mailgun } from "./mailgun.js";
import { mailpace } from "./mailpace.js";
import { mailtrap } from "./mailtrap.js";
import { plunk } from "./plunk.js";
import { postmark } from "./postmark.js";
import { resend } from "./resend.js";
import { scaleway } from "./scaleway.js";
import { sendgrid } from "./sendgrid.js";
import { sparkpost } from "./sparkpost.js";
import type { EmailMessage, EmailProvider, EmailProviderResponse } from "./types.js";
import { zeptomail } from "./zeptomail.js";

type SmokeFlags = Record<string, string | true>;

type SmokeProvider = {
  name: string;
  env: string[];
  optionalEnv?: string[];
  create: () => EmailProvider;
};

const flags = parseFlags(Bun.argv.slice(2));
const sendLive = truthyFlag("send");
const selectedAdapters = selectedAdapterNames();
const to = stringFlag("to") ?? process.env.LIVE_EMAIL_TO ?? "leodoesdev@gmail.com";
const subjectPrefix =
  stringFlag("subject-prefix") ?? process.env.LIVE_EMAIL_SUBJECT_PREFIX ?? "Email SDK live smoke";

const providers: SmokeProvider[] = [
  {
    name: "resend",
    env: ["RESEND_API_KEY"],
    create: () => resend({ apiKey: env("RESEND_API_KEY") }),
  },
  {
    name: "postmark",
    env: ["POSTMARK_SERVER_TOKEN"],
    optionalEnv: ["POSTMARK_MESSAGE_STREAM"],
    create: () =>
      postmark({
        serverToken: env("POSTMARK_SERVER_TOKEN"),
        messageStream: process.env.POSTMARK_MESSAGE_STREAM,
      }),
  },
  {
    name: "sendgrid",
    env: ["SENDGRID_API_KEY"],
    create: () => sendgrid({ apiKey: env("SENDGRID_API_KEY") }),
  },
  {
    name: "mailgun",
    env: ["MAILGUN_API_KEY", "MAILGUN_DOMAIN"],
    optionalEnv: ["MAILGUN_BASE_URL"],
    create: () =>
      mailgun({
        apiKey: env("MAILGUN_API_KEY"),
        domain: env("MAILGUN_DOMAIN"),
        baseUrl: process.env.MAILGUN_BASE_URL,
      }),
  },
  {
    name: "mailersend",
    env: ["MAILERSEND_API_KEY"],
    create: () => mailersend({ apiKey: env("MAILERSEND_API_KEY") }),
  },
  {
    name: "brevo",
    env: ["BREVO_API_KEY"],
    create: () => brevo({ apiKey: env("BREVO_API_KEY") }),
  },
  {
    name: "mailchimp",
    env: ["MAILCHIMP_API_KEY"],
    create: () => mailchimp({ apiKey: env("MAILCHIMP_API_KEY") }),
  },
  {
    name: "sparkpost",
    env: ["SPARKPOST_API_KEY"],
    create: () => sparkpost({ apiKey: env("SPARKPOST_API_KEY") }),
  },
  {
    name: "loops",
    env: ["LOOPS_API_KEY", "LOOPS_TRANSACTIONAL_ID"],
    create: () =>
      loops({
        apiKey: env("LOOPS_API_KEY"),
        transactionalId: env("LOOPS_TRANSACTIONAL_ID"),
      }),
  },
  {
    name: "plunk",
    env: ["PLUNK_API_KEY"],
    create: () => plunk({ apiKey: env("PLUNK_API_KEY") }),
  },
  {
    name: "mailtrap",
    env: ["MAILTRAP_API_KEY"],
    create: () => mailtrap({ apiKey: env("MAILTRAP_API_KEY") }),
  },
  {
    name: "scaleway",
    env: ["SCALEWAY_SECRET_KEY", "SCALEWAY_PROJECT_ID"],
    optionalEnv: ["SCALEWAY_REGION"],
    create: () =>
      scaleway({
        secretKey: env("SCALEWAY_SECRET_KEY"),
        projectId: env("SCALEWAY_PROJECT_ID"),
        region: process.env.SCALEWAY_REGION,
      }),
  },
  {
    name: "zeptomail",
    env: ["ZEPTOMAIL_TOKEN"],
    create: () => zeptomail({ token: env("ZEPTOMAIL_TOKEN") }),
  },
  {
    name: "mailpace",
    env: ["MAILPACE_API_KEY"],
    create: () => mailpace({ apiKey: env("MAILPACE_API_KEY") }),
  },
];

if (truthyFlag("help")) {
  printHelp();
  process.exit(0);
}

const candidates = providers.filter((provider) => {
  return selectedAdapters.length === 0 || selectedAdapters.includes(provider.name);
});

if (candidates.length === 0) {
  console.error(
    `No matching adapters. Known adapters: ${providers.map((item) => item.name).join(", ")}`,
  );
  process.exit(1);
}

const results: Array<
  | { ok: true; adapter: string; sent: boolean; response?: EmailProviderResponse }
  | { ok: false; adapter: string; skipped?: boolean; missing?: string[]; error?: string }
> = [];

for (const provider of candidates) {
  const missing = provider.env.filter((name) => !process.env[name]);
  const liveFrom = senderFor(provider.name);

  if (!liveFrom) {
    missing.push(`LIVE_EMAIL_FROM_${envSuffix(provider.name)} or LIVE_EMAIL_FROM or --from`);
  }

  if (missing.length > 0) {
    results.push({ ok: false, adapter: provider.name, skipped: true, missing });
    continue;
  }

  const message = buildMessage(provider.name, liveFrom as string);

  if (!sendLive) {
    results.push({ ok: true, adapter: provider.name, sent: false });
    continue;
  }

  try {
    const client = createEmailClient({ adapters: [provider.create()] });
    const response = await client.send(message, {
      idempotencyKey: `email-sdk-live-smoke-${provider.name}-${Date.now()}`,
      metadata: { test: "live-smoke", adapter: provider.name },
    });

    results.push({
      ok: true,
      adapter: provider.name,
      sent: true,
      response: redactResponse(response),
    });
  } catch (error) {
    results.push({
      ok: false,
      adapter: provider.name,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

const summary = {
  mode: sendLive ? "send" : "dry-run",
  to,
  results,
};

console.log(JSON.stringify(summary, null, 2));

if (results.some((result) => !result.ok && !result.skipped)) {
  process.exit(1);
}

function buildMessage(adapter: string, from: string): EmailMessage {
  const subject = `${subjectPrefix} [${adapter}]`;

  return {
    from,
    to,
    subject,
    text: [
      "Email SDK live smoke test.",
      `Adapter: ${adapter}`,
      `Timestamp: ${new Date().toISOString()}`,
    ].join("\n"),
    html: [
      "<p>Email SDK live smoke test.</p>",
      `<p><strong>Adapter:</strong> ${escapeHtml(adapter)}</p>`,
      `<p><strong>Timestamp:</strong> ${escapeHtml(new Date().toISOString())}</p>`,
    ].join(""),
  };
}

function redactResponse(response: EmailProviderResponse) {
  return {
    provider: response.provider,
    id: response.id,
    messageId: response.messageId,
    accepted: response.accepted,
    rejected: response.rejected,
  };
}

function selectedAdapterNames() {
  const adapterFlag =
    stringFlag("adapter") ?? stringFlag("provider") ?? process.env.LIVE_EMAIL_ADAPTERS;

  return adapterFlag
    ? adapterFlag
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    : [];
}

function senderFor(adapter: string) {
  return (
    stringFlag("from") ??
    process.env[`LIVE_EMAIL_FROM_${envSuffix(adapter)}`] ??
    process.env.LIVE_EMAIL_FROM
  );
}

function envSuffix(adapter: string) {
  return adapter.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function parseFlags(args: string[]): SmokeFlags {
  const parsed: SmokeFlags = {};

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
      parsed[key] = inlineValue;
      continue;
    }

    const next = args[index + 1];

    if (!next || next.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}

function stringFlag(name: string) {
  const value = flags[name];
  return typeof value === "string" ? value : undefined;
}

function truthyFlag(name: string) {
  const value = flags[name];
  return value === true || value === "true" || value === "1";
}

function env(name: string) {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing ${name}`);
  }

  return value;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      case "'":
        return "&#039;";
      default:
        return character;
    }
  });
}

function printHelp() {
  console.log(`Email SDK live smoke

Usage:
  bun run live:smoke -- --from "Acme <hello@example.com>"
  bun run live:smoke -- --send --adapter resend,postmark --from "Acme <hello@example.com>"

Options:
  --send                         Actually send emails. Omit for a non-sending env check.
  --adapter <names>              Comma-separated adapter names. Defaults to all known adapters.
  --provider <names>             Alias for --adapter.
  --from <address>               Verified sender address. Defaults to LIVE_EMAIL_FROM.
                                  Can be overridden per adapter with LIVE_EMAIL_FROM_RESEND, etc.
  --to <address>                 Recipient. Defaults to LIVE_EMAIL_TO or leodoesdev@gmail.com.
  --subject-prefix <text>        Subject prefix. Defaults to LIVE_EMAIL_SUBJECT_PREFIX.

Environment:
  LIVE_EMAIL_FROM                Verified sender used for all adapters.
  LIVE_EMAIL_TO                  Smoke recipient.
  LIVE_EMAIL_ADAPTERS            Optional comma-separated adapter filter.
`);
}
