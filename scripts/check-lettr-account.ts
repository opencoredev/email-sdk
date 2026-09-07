import { config } from "dotenv";
import { runDoctor } from "../packages/email-sdk/src/doctor.js";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { lettr } from "../packages/email-sdk/src/lettr.js";

config({ path: ".env.local" });
config();

const baseUrl = process.env.LETTR_BASE_URL ?? "https://app.lettr.com/api";
const apiKey = process.env.LETTR_API_KEY;

if (!apiKey) {
  fail("Missing LETTR_API_KEY. Set it in your shell or .env.local.");
}

const result = await runDoctor({ adapter: "lettr", credential: apiKey, live: true, baseUrl });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

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

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
