import { config } from "dotenv";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { lettr } from "../packages/email-sdk/src/lettr.js";

config({ path: ".env.local" });
config();

const baseUrl = process.env.LETTR_BASE_URL ?? "https://app.lettr.com/api";
const apiKey = process.env.LETTR_API_KEY;

if (!apiKey) {
  fail("Missing LETTR_API_KEY. Set it in your shell or .env.local.");
}

// Validate the key on the send endpoint so Sending Only keys pass. An empty
// payload authenticates and then fails validation with a 422, never a 401.
const authProbe = await fetch(`${baseUrl}/emails`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
  },
  body: JSON.stringify({}),
});

const authBody = await authProbe.text();

if (authProbe.status === 401 || authProbe.status === 403) {
  fail(`Lettr rejected the API key (HTTP ${authProbe.status}): ${truncate(authBody)}`);
}

const authenticated =
  authProbe.status === 422 ||
  authProbe.status === 400 ||
  (authProbe.status >= 200 && authProbe.status < 300);

console.log(
  JSON.stringify(
    {
      ok: authenticated,
      provider: "lettr",
      check: "auth",
      status: authProbe.status,
      authenticated,
      detail: truncate(authBody),
    },
    null,
    2,
  ),
);

if (!authenticated) {
  fail(
    `Lettr auth probe inconclusive (HTTP ${authProbe.status}); expected 422 or 400 for the empty probe payload.`,
  );
}

if (process.env.LETTR_LIVE_SEND !== "true") {
  process.exit(0);
}

const from = requiredEnv("LETTR_TEST_FROM");
const to = requiredEnv("LETTR_TEST_TO");
const email = createEmailClient({
  adapters: [
    lettr({
      apiKey,
      baseUrl,
    }),
  ],
});

const response = await email.send({
  from,
  to,
  subject: process.env.LETTR_TEST_SUBJECT ?? "Email SDK Lettr smoke test",
  text:
    process.env.LETTR_TEST_TEXT ??
    "Email SDK Lettr smoke test. If you received this, the adapter can send.",
  html:
    process.env.LETTR_TEST_HTML ??
    "<p>Email SDK Lettr smoke test. If you received this, the adapter can send.</p>",
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
    fail(`Missing ${name}. Set it before using LETTR_LIVE_SEND=true.`);
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
