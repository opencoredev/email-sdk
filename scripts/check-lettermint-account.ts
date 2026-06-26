import { config } from "dotenv";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { lettermint } from "../packages/email-sdk/src/lettermint.js";

config({ path: ".env.local" });
config();

const baseUrl = process.env.LETTERMINT_BASE_URL ?? "https://api.lettermint.co/v1";
const apiToken = process.env.LETTERMINT_API_TOKEN;

if (!apiToken) {
  fail("Missing LETTERMINT_API_TOKEN. Set it in your shell or .env.local.");
}

// Validate the token by confirming the send endpoint authenticates it: an empty
// payload authenticates and then fails validation with a 422, never a 401.
const authProbe = await fetch(`${baseUrl}/send`, {
  method: "POST",
  headers: {
    "x-lettermint-token": apiToken,
    "Content-Type": "application/json",
    Accept: "application/json",
  },
  body: JSON.stringify({}),
});

const authBody = await authProbe.text();

if (authProbe.status === 401 || authProbe.status === 403) {
  fail(`Lettermint rejected the API token (HTTP ${authProbe.status}): ${truncate(authBody)}`);
}

// The empty probe payload should authenticate and then fail validation with a
// 422 (missing from/to/subject). Treat 422, 400, or any 2xx as proof the token
// passed auth; 401 and 403 are bad tokens, and 5xx or unexpected proxy/WAF
// bodies are inconclusive.
const authenticated =
  authProbe.status === 422 ||
  authProbe.status === 400 ||
  (authProbe.status >= 200 && authProbe.status < 300);

console.log(
  JSON.stringify(
    {
      ok: authenticated,
      provider: "lettermint",
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
    `Lettermint auth probe inconclusive (HTTP ${authProbe.status}); expected 422 or 400 for the empty probe payload.`,
  );
}

if (process.env.LETTERMINT_LIVE_SEND !== "true") {
  process.exit(0);
}

const from = requiredEnv("LETTERMINT_TEST_FROM");
const to = requiredEnv("LETTERMINT_TEST_TO");
const email = createEmailClient({
  adapters: [
    lettermint({
      apiToken,
      baseUrl,
      route: process.env.LETTERMINT_ROUTE,
    }),
  ],
});

const response = await email.send({
  from,
  to,
  subject: process.env.LETTERMINT_TEST_SUBJECT ?? "Email SDK Lettermint smoke test",
  text:
    process.env.LETTERMINT_TEST_TEXT ??
    "Email SDK Lettermint smoke test. If you received this, the adapter can send.",
  html:
    process.env.LETTERMINT_TEST_HTML ??
    "<p>Email SDK Lettermint smoke test. If you received this, the adapter can send.</p>",
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
    fail(`Missing ${name}. Set it before using LETTERMINT_LIVE_SEND=true.`);
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
