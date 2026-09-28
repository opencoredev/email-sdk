import { config } from "dotenv";
import { runDoctor } from "../packages/email-sdk/src/doctor.js";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { eusend } from "../packages/email-sdk/src/eusend.js";

config({ path: ".env.local" });

config();

const baseUrl = process.env.EUSEND_BASE_URL ?? "https://api.eusend.dev";

const apiKey = process.env.EUSEND_API_KEY;

if (!apiKey) {
  fail("Missing EUSEND_API_KEY. Set it in your shell or .env.local.");
}

const result = await runDoctor({ adapter: "eusend", credential: apiKey, live: true, baseUrl });

console.log(JSON.stringify(result, null, 2));

if (!result.ok) process.exit(1);

if (process.env.EUSEND_LIVE_SEND !== "true") {
  process.exit(0);
}

const from = requiredEnv("EUSEND_TEST_FROM");

const to = requiredEnv("EUSEND_TEST_TO");

const email = createEmailClient({
  adapters: [
    eusend({
      apiKey,
      baseUrl,
    }),
  ],
});

const response = await email.send({
  from,
  to,
  subject: process.env.EUSEND_TEST_SUBJECT ?? "Email SDK eusend smoke test",
  text:
    process.env.EUSEND_TEST_TEXT ??
    "Email SDK eusend smoke test. If you received this, the adapter can send.",
  html:
    process.env.EUSEND_TEST_HTML ??
    "<p>Email SDK eusend smoke test. If you received this, the adapter can send.</p>",
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
    fail(`Missing ${name}. Set it before using EUSEND_LIVE_SEND=true.`);
  }

  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
