import { config } from "dotenv";
import { runDoctor } from "../packages/email-sdk/src/doctor.js";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { reloop } from "../packages/email-sdk/src/reloop.js";

config({ path: ".env.local" });

config();

const baseUrl = process.env.RELOOP_BASE_URL ?? "https://reloop.sh";

const apiKey = process.env.RELOOP_API_KEY;

if (!apiKey) {
  fail("Missing RELOOP_API_KEY. Set it in your shell or .env.local.");
}

const result = await runDoctor({ adapter: "reloop", credential: apiKey, live: true, baseUrl });

console.log(JSON.stringify(result, null, 2));

if (!result.ok) process.exit(1);

if (process.env.RELOOP_LIVE_SEND !== "true") {
  process.exit(0);
}

const from = requiredEnv("RELOOP_TEST_FROM");

const to = requiredEnv("RELOOP_TEST_TO");

const email = createEmailClient({
  adapters: [
    reloop({
      apiKey,
      baseUrl,
    }),
  ],
});

const response = await email.send({
  from,
  to,
  subject: process.env.RELOOP_TEST_SUBJECT ?? "Email SDK Reloop smoke test",
  text:
    process.env.RELOOP_TEST_TEXT ??
    "Email SDK Reloop smoke test. If you received this, the adapter can send.",
  html:
    process.env.RELOOP_TEST_HTML ??
    "<p>Email SDK Reloop smoke test. If you received this, the adapter can send.</p>",
});

console.log(
  JSON.stringify(
    {
      ok: true,
      adapter: response.adapter,
      check: "send",
      id: response.id,
    },
    null,
    2,
  ),
);

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    fail(`Missing ${name}. Set it before using RELOOP_LIVE_SEND=true.`);
  }

  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
