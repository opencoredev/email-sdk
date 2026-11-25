import { config } from "dotenv";
import { runDoctor } from "../packages/email-sdk/src/doctor.js";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { nightmail } from "../packages/email-sdk/src/nightmail.js";

config({ path: ".env.local" });

config();

const baseUrl = process.env.NIGHTMAIL_BASE_URL ?? "https://nightmail.dev";

const apiKey = process.env.NIGHTMAIL_API_KEY;

if (!apiKey) {
  fail("Missing NIGHTMAIL_API_KEY. Set it in your shell or .env.local.");
}

const result = await runDoctor({ adapter: "nightmail", credential: apiKey, live: true, baseUrl });

console.log(JSON.stringify(result, null, 2));

if (!result.ok) process.exit(1);

if (process.env.NIGHTMAIL_LIVE_SEND !== "true") {
  process.exit(0);
}

const from = requiredEnv("NIGHTMAIL_TEST_FROM");

// Amazon SES's simulator accepts the message without reaching a real inbox.
const to = process.env.NIGHTMAIL_TEST_TO ?? "success@simulator.amazonses.com";

const email = createEmailClient({ adapters: [nightmail({ apiKey, baseUrl })] });

const response = await email.send({
  from,
  to,
  subject: process.env.NIGHTMAIL_TEST_SUBJECT ?? "Email SDK Nightmail smoke test",
  text:
    process.env.NIGHTMAIL_TEST_TEXT ??
    "Email SDK Nightmail smoke test. If you received this, the adapter can send.",
  html:
    process.env.NIGHTMAIL_TEST_HTML ??
    "<p>Email SDK Nightmail smoke test. If you received this, the adapter can send.</p>",
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
    fail(`Missing ${name}. Set it before using NIGHTMAIL_LIVE_SEND=true.`);
  }

  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
