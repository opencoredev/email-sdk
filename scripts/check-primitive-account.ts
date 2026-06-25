import { config } from "dotenv";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { primitive } from "../packages/email-sdk/src/primitive.js";

config({ path: ".env.local" });
config();

const baseUrl = process.env.PRIMITIVE_BASE_URL ?? "https://api.primitive.dev/v1";
const apiKey = process.env.PRIMITIVE_API_KEY;

if (!apiKey) {
  fail("Missing PRIMITIVE_API_KEY. Set it in your shell or .env.local.");
}

// Validate the key by confirming the send endpoint authenticates it: an empty
// payload authenticates and then fails validation with a 400, never a 401.
const authProbe = await fetch(`${baseUrl}/send-mail`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({}),
});

const authBody = await authProbe.text();

if (authProbe.status === 401) {
  fail(`Primitive rejected the API key (401 Unauthorized): ${truncate(authBody)}`);
}

// The empty probe payload should authenticate and then fail validation with a
// 400 (verified live). Treat 400, 422 (some APIs use it for a structurally
// valid but incomplete body), or any 2xx as proof the key passed auth; 401 is a
// bad key, and 403, 5xx, and unexpected proxy/WAF bodies are inconclusive.
const authenticated =
  authProbe.status === 400 ||
  authProbe.status === 422 ||
  (authProbe.status >= 200 && authProbe.status < 300);

console.log(
  JSON.stringify(
    {
      ok: authenticated,
      provider: "primitive",
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
    `Primitive auth probe inconclusive (HTTP ${authProbe.status}); expected 400 or 422 for the empty probe payload.`,
  );
}

if (process.env.PRIMITIVE_LIVE_SEND !== "true") {
  process.exit(0);
}

const from = requiredEnv("PRIMITIVE_TEST_FROM");
const to = requiredEnv("PRIMITIVE_TEST_TO");
const email = createEmailClient({
  adapters: [
    primitive({
      apiKey,
      baseUrl,
    }),
  ],
});

const response = await email.send({
  from,
  to,
  subject: process.env.PRIMITIVE_TEST_SUBJECT ?? "Email SDK Primitive smoke test",
  text:
    process.env.PRIMITIVE_TEST_TEXT ??
    "Email SDK Primitive smoke test. If you received this, the adapter can send.",
  html:
    process.env.PRIMITIVE_TEST_HTML ??
    "<p>Email SDK Primitive smoke test. If you received this, the adapter can send.</p>",
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
    fail(`Missing ${name}. Set it before using PRIMITIVE_LIVE_SEND=true.`);
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
