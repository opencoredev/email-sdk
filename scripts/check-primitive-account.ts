import { config } from "dotenv";
import { runDoctor } from "../packages/email-sdk/src/doctor.js";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { primitive } from "../packages/email-sdk/src/primitive.js";

config({ path: ".env.local" });
config();

const baseUrl = process.env.PRIMITIVE_BASE_URL ?? "https://api.primitive.dev/v1";
const apiKey = process.env.PRIMITIVE_API_KEY;

if (!apiKey) {
  fail("Missing PRIMITIVE_API_KEY. Set it in your shell or .env.local.");
}

const result = await runDoctor({ adapter: "primitive", credential: apiKey, live: true, baseUrl });
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

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

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
