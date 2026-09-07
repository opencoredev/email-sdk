import { config } from "dotenv";
import { runDoctor } from "../packages/email-sdk/src/doctor.js";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { lettermint } from "../packages/email-sdk/src/lettermint.js";

config({ path: ".env.local" });
config();

const baseUrl = process.env.LETTERMINT_BASE_URL ?? "https://api.lettermint.co/v1";
const apiToken = process.env.LETTERMINT_API_TOKEN;

if (!apiToken) {
  fail("Missing LETTERMINT_API_TOKEN. Set it in your shell or .env.local.");
}

const result = await runDoctor({
  adapter: "lettermint",
  credential: apiToken,
  live: true,
  baseUrl,
});
console.log(JSON.stringify(result, null, 2));
if (!result.ok) process.exit(1);

if (process.env.LETTERMINT_LIVE_SEND !== "true") {
  process.exit(0);
}

const from = requiredEnv("LETTERMINT_TEST_FROM");
const to = requiredEnv("LETTERMINT_TEST_TO");
const email = createEmailClient({
  adapters: [
    lettermint({
      apiToken,
      baseUrl,
      route: process.env.LETTERMINT_ROUTE,
    }),
  ],
});

const response = await email.send({
  from,
  to,
  subject: process.env.LETTERMINT_TEST_SUBJECT ?? "Email SDK Lettermint smoke test",
  text:
    process.env.LETTERMINT_TEST_TEXT ??
    "Email SDK Lettermint smoke test. If you received this, the adapter can send.",
  html:
    process.env.LETTERMINT_TEST_HTML ??
    "<p>Email SDK Lettermint smoke test. If you received this, the adapter can send.</p>",
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
    fail(`Missing ${name}. Set it before using LETTERMINT_LIVE_SEND=true.`);
  }

  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
