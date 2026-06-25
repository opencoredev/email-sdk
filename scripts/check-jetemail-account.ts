import { config } from "dotenv";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { jetemail } from "../packages/email-sdk/src/jetemail.js";

config({ path: ".env.local" });
config();

const baseUrl = process.env.JETEMAIL_BASE_URL ?? "https://api.jetemail.com";
const apiKey = process.env.JETEMAIL_API_KEY;

if (!apiKey) {
  fail("Missing JETEMAIL_API_KEY. Set it in your shell or .env.local.");
}

// Transactional keys are scoped to /email and /email-batch, so the key is
// validated by confirming the send endpoint authenticates it: a malformed
// payload is rejected with a 4xx validation error, never 401 Unauthorized.
const authProbe = await fetch(`${baseUrl}/email`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({}),
});

const authBody = await authProbe.text();

if (authProbe.status === 401) {
  fail(`JetEmail rejected the API key (401 Unauthorized): ${truncate(authBody)}`);
}

console.log(
  JSON.stringify(
    {
      ok: true,
      provider: "jetemail",
      check: "auth",
      status: authProbe.status,
      authenticated: true,
      detail: truncate(authBody),
    },
    null,
    2,
  ),
);

if (process.env.JETEMAIL_LIVE_SEND !== "true") {
  process.exit(0);
}

const from = requiredEnv("JETEMAIL_TEST_FROM");
const to = requiredEnv("JETEMAIL_TEST_TO");
const email = createEmailClient({
  adapters: [
    jetemail({
      apiKey,
      baseUrl,
    }),
  ],
});

const response = await email.send({
  from,
  to,
  subject: process.env.JETEMAIL_TEST_SUBJECT ?? "Email SDK JetEmail smoke test",
  text:
    process.env.JETEMAIL_TEST_TEXT ??
    "Email SDK JetEmail smoke test. If you received this, the adapter can send.",
  html:
    process.env.JETEMAIL_TEST_HTML ??
    "<p>Email SDK JetEmail smoke test. If you received this, the adapter can send.</p>",
});

console.log(
  JSON.stringify(
    {
      ok: true,
      provider: response.provider,
      check: "send",
      id: response.id,
      messageId: response.messageId,
    },
    null,
    2,
  ),
);

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    fail(`Missing ${name}. Set it before using JETEMAIL_LIVE_SEND=true.`);
  }

  return value;
}

function truncate(value: string) {
  const trimmed = value.trim();
  return trimmed.length > 300 ? `${trimmed.slice(0, 300)}…` : trimmed;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
