import { config } from "dotenv";
import { runDoctor } from "../packages/email-sdk/src/doctor.js";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { sendheron } from "../packages/email-sdk/src/sendheron.js";

config({ path: ".env.local" });
config();

const baseUrl = process.env.SENDHERON_BASE_URL ?? "https://api.sendheron.com/api/v1";
const apiKey = process.env.SENDHERON_API_KEY;

if (!apiKey) {
  fail("Missing SENDHERON_API_KEY. Set it in your shell or .env.local.");
}

const result = await runDoctor({ adapter: "sendheron", credential: apiKey, live: true, baseUrl });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

if (process.env.SENDHERON_LIVE_SEND !== "true") {
  process.exit(0);
}

const from = requiredEnv("SENDHERON_TEST_FROM");
const to = requiredEnv("SENDHERON_TEST_TO");
const email = createEmailClient({
  adapters: [
    sendheron({
      apiKey,
      baseUrl,
    }),
  ],
});

const response = await email.send({
  from,
  to,
  subject: process.env.SENDHERON_TEST_SUBJECT ?? "Email SDK SendHeron smoke test",
  text:
    process.env.SENDHERON_TEST_TEXT ??
    "Email SDK SendHeron smoke test. If you received this, the adapter can send.",
  html:
    process.env.SENDHERON_TEST_HTML ??
    "<p>Email SDK SendHeron smoke test. If you received this, the adapter can send.</p>",
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
    fail(`Missing ${name}. Set it before using SENDHERON_LIVE_SEND=true.`);
  }

  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
