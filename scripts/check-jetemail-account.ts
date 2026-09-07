import { config } from "dotenv";
import { runDoctor } from "../packages/email-sdk/src/doctor.js";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { jetemail } from "../packages/email-sdk/src/jetemail.js";

config({ path: ".env.local" });
config();

const baseUrl = process.env.JETEMAIL_BASE_URL ?? "https://api.jetemail.com";
const apiKey = process.env.JETEMAIL_API_KEY;

if (!apiKey) {
  fail("Missing JETEMAIL_API_KEY. Set it in your shell or .env.local.");
}

const result = await runDoctor({ adapter: "jetemail", credential: apiKey, live: true, baseUrl });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

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

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
