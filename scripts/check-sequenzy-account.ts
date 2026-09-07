import { config } from "dotenv";
import { runDoctor } from "../packages/email-sdk/src/doctor.js";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { sequenzy } from "../packages/email-sdk/src/sequenzy.js";

config({ path: ".env.local" });
config();

const baseUrl = process.env.SEQUENZY_BASE_URL ?? "https://api.sequenzy.com/api/v1";
const apiKey = process.env.SEQUENZY_API_KEY;

if (!apiKey) {
  fail("Missing SEQUENZY_API_KEY. Set it in your shell or .env.local.");
}

const result = await runDoctor({ adapter: "sequenzy", credential: apiKey, live: true, baseUrl });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

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

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    fail(`Missing ${name}. Set it before using SEQUENZY_LIVE_SEND=true.`);
  }

  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
