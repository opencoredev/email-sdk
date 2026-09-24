import { config } from "dotenv";
import { z } from "zod";

import { createEmailClient } from "../packages/email-sdk/src/core.js";
import { graph } from "../packages/email-sdk/src/graph.js";

const tokenResponseSchema = z.object({ access_token: z.string() });

config({ path: ".env.local" });

config();

const tenantId = requiredEnv("MS_GRAPH_TENANT_ID");

const clientId = requiredEnv("MS_GRAPH_CLIENT_ID");

const clientSecret = requiredEnv("MS_GRAPH_CLIENT_SECRET");

const user = requiredEnv("MS_GRAPH_USER");

await verifyToken(tenantId, clientId, clientSecret);

if (process.env.MS_GRAPH_LIVE_SEND !== "true") {
  process.exit(0);
}

const to = requiredEnv("MS_GRAPH_TEST_TO");

const email = createEmailClient({
  adapters: [graph({ tenantId, clientId, clientSecret, user, saveToSentItems: false })],
});

const response = await email.send({
  from: process.env.MS_GRAPH_TEST_FROM ?? user,
  to,
  subject: process.env.MS_GRAPH_TEST_SUBJECT ?? "Email SDK Graph smoke test",
  text:
    process.env.MS_GRAPH_TEST_TEXT ??
    "Email SDK Graph smoke test. If you received this, the adapter can send.",
  html:
    process.env.MS_GRAPH_TEST_HTML ??
    "<p>Email SDK Graph smoke test. If you received this, the adapter can send.</p>",
});

console.log(
  JSON.stringify({ ok: true, adapter: response.adapter, check: "send" }, null, 2),
);

async function verifyToken(tenantId: string, clientId: string, clientSecret: string) {
  const tokenResponse = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        scope: "https://graph.microsoft.com/.default",
        grant_type: "client_credentials",
      }),
    },
  );

  const tokenBody = tokenResponseSchema.safeParse(await tokenResponse.json().catch(() => null));

  if (!tokenResponse.ok) {
    fail(`Graph token request failed with HTTP ${tokenResponse.status}.`);
  }

  if (!tokenBody.success) {
    fail("Graph token response did not contain an access_token.");
  }

  console.log(
    JSON.stringify({ ok: true, adapter: "graph", check: "client_credentials_token" }, null, 2),
  );
}

function requiredEnv(name: string) {
  const value = process.env[name];

  if (!value) {
    fail(`Missing ${name}. Set it before using MS_GRAPH_LIVE_SEND=true.`);
  }

  return value;
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
