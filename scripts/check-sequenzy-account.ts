import { config } from "dotenv";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { sequenzy } from "../packages/email-sdk/src/sequenzy.js";

config({ path: ".env.local" });
config();

const baseUrl = process.env.SEQUENZY_BASE_URL ?? "https://api.sequenzy.com/api/v1";
const apiKey = process.env.SEQUENZY_API_KEY;

if (!apiKey) {
  fail("Missing SEQUENZY_API_KEY. Set it in your shell or .env.local.");
}

const account = await fetchJson(`${baseUrl}/account`, {
  headers: {
    Authorization: `Bearer ${apiKey}`,
  },
});

if (!account.success) {
  fail(`Sequenzy account check failed: ${account.error ?? "Unknown error"}`);
}

const companyCount = Array.isArray(account.companies) ? account.companies.length : 0;
console.log(
  JSON.stringify(
    {
      ok: true,
      provider: "sequenzy",
      check: "account",
      companyCount,
      currentCompanyId: stringValue(account.currentCompanyId),
    },
    null,
    2,
  ),
);

if (process.env.SEQUENZY_LIVE_SEND !== "true") {
  process.exit(0);
}

const from = requiredEnv("SEQUENZY_TEST_FROM");
const to = requiredEnv("SEQUENZY_TEST_TO");
const email = createEmailClient({
  adapters: [
    sequenzy({
      apiKey,
      baseUrl,
    }),
  ],
});

const response = await email.send({
  from,
  to,
  subject: process.env.SEQUENZY_TEST_SUBJECT ?? "Email SDK Sequenzy smoke test",
  html:
    process.env.SEQUENZY_TEST_HTML ??
    "<p>Email SDK Sequenzy smoke test. If you received this, the adapter can send.</p>",
  metadata: {
    source: "email-sdk-live-check",
  },
});

console.log(
  JSON.stringify(
    {
      ok: true,
      provider: response.provider,
      check: "send",
      id: response.id,
      messageId: response.messageId,
      acceptedCount: response.accepted?.length,
    },
    null,
    2,
  ),
);

async function fetchJson(url: string, init: RequestInit) {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

  if (!response.ok) {
    fail(`Sequenzy account check failed with HTTP ${response.status}: ${errorText(body)}`);
  }

  return body;
}

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    fail(`Missing ${name}. Set it before using SEQUENZY_LIVE_SEND=true.`);
  }

  return value;
}

function errorText(body: Record<string, unknown>) {
  return stringValue(body.error) ?? stringValue(body.message) ?? "Unknown error";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
