import { config } from "dotenv";
import { runDoctor } from "../packages/email-sdk/src/doctor.js";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { helo } from "../packages/email-sdk/src/helo.js";

config({ path: ".env.local" });

config();

const baseUrl = process.env.HELO_BASE_URL ?? "https://api.helohq.com";

const apiKey = process.env.HELO_API_KEY;

if (!apiKey) {
  fail("Missing HELO_API_KEY. Set it in your shell or .env.local.");
}

const result = await runDoctor({ adapter: "helo", credential: apiKey, live: true, baseUrl });

console.log(JSON.stringify(result, null, 2));

if (!result.ok) process.exit(1);

if (process.env.HELO_LIVE_SEND !== "true") {
  process.exit(0);
}

const from = requiredEnv("HELO_TEST_FROM");

const to = requiredEnv("HELO_TEST_TO");

const email = createEmailClient({
  adapters: [
    helo({
      apiKey,
      channelId: process.env.HELO_CHANNEL_ID,
      baseUrl,
    }),
  ],
});

const response = await email.send({
  from,
  to,
  subject: process.env.HELO_TEST_SUBJECT ?? "Email SDK Helo smoke test",
  text:
    process.env.HELO_TEST_TEXT ??
    "Email SDK Helo smoke test. If you received this, the adapter can send.",
  html:
    process.env.HELO_TEST_HTML ??
    "<p>Email SDK Helo smoke test. If you received this, the adapter can send.</p>",
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
    fail(`Missing ${name}. Set it before using HELO_LIVE_SEND=true.`);
  }

  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
