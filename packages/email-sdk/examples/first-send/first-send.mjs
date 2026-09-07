import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { config } from "dotenv";
import { createEmailClient, EmailSdkError } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";

// The value shipped in .env.example; never accepted for a real send.
const PLACEHOLDER_KEY = "re_replace_with_real_server_key";
const MAILBOX =
  /^(?:[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+|[^<>\r\n]+<[^\s<>@,]+@[^\s<>@,]+\.[^\s<>@,]+>)$/;
// RFC 2606 reserved names: example.com/net/org and the .test/.example/.invalid/.localhost TLDs.
const EXAMPLE_DOMAIN = /@(example\.(com|org|net)|[^\s>]*\.(test|example|invalid|localhost))(>|$)/i;

// Process environment wins, then .env.local, then .env (all relative to this file).
export function loadEnvironment() {
  for (const name of [".env.local", ".env"]) {
    config({ path: fileURLToPath(new URL(name, import.meta.url)), override: false, quiet: true });
  }
}

// `fixture` is import-only: tests inject a loopback Resend stand-in. No CLI flag or
// environment variable can redirect where the real command sends credentials.
function fixtureTransport(fixture, env) {
  const url = new URL(fixture.baseUrl);
  if (
    url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port ||
    url.username || url.password || url.pathname !== "/" || url.search || url.hash
  ) {
    throw new Error("Fixtures require an explicit http://127.0.0.1:PORT origin.");
  }
  if (env.RESEND_API_KEY && env.RESEND_API_KEY !== "re_fixture_only") {
    throw new Error("Fixtures reject real credentials; use re_fixture_only.");
  }
  return {
    apiKey: "re_fixture_only",
    baseUrl: url.origin,
    fetch: (input, init) => {
      if (String(input) !== `${url.origin}/emails`) throw new Error("Fixture URL rejected.");
      return (fixture.fetch ?? fetch)(input, { ...init, redirect: "error" });
    },
  };
}

function assertSendConfigured(env, fixture) {
  if (!env.EMAIL_FROM?.trim() || !env.EMAIL_TO?.trim()) {
    throw new Error(
      "Set EMAIL_FROM and EMAIL_TO to an approved sender and recipient before --send.",
    );
  }
  if (fixture) return;
  const key = env.RESEND_API_KEY?.trim() ?? "";
  if (!key.startsWith("re_") || key === PLACEHOLDER_KEY) {
    throw new Error("Set a real server-only RESEND_API_KEY (starts with re_) before --send.");
  }
  if ([env.EMAIL_FROM, env.EMAIL_TO].some((address) => EXAMPLE_DOMAIN.test(address.trim()))) {
    throw new Error("Replace example addresses with approved real addresses before --send.");
  }
}

export async function run({ args = [], env = process.env, fixture } = {}) {
  if (args.length > 1 || args.some((arg) => arg !== "--send")) {
    throw new Error("Usage: node first-send.mjs [--send]");
  }
  const sending = args.includes("--send");
  if (sending) assertSendConfigured(env, fixture);

  const message = {
    from: env.EMAIL_FROM || "Starter <hello@example.com>",
    to: env.EMAIL_TO || "recipient@example.com",
    subject: "Your first Email SDK message",
    text: "Hello from the standalone Email SDK starter.",
  };
  if (![message.from, message.to].every((address) => MAILBOX.test(address.trim()))) {
    throw new Error("Set EMAIL_FROM and EMAIL_TO to one valid mailbox each.");
  }

  // Validation never contacts Resend, so it does not need a real key.
  const adapterOptions = fixture
    ? fixtureTransport(fixture, env)
    : { apiKey: sending ? env.RESEND_API_KEY : "re_validation_only" };
  const email = createEmailClient({
    adapters: [resend(adapterOptions)],
    ...(fixture ? { telemetry: false } : {}),
  });
  try {
    await email.validate(message);
    if (!sending) return { ok: true, mode: "validate", adapter: "resend", sent: false };
    const result = await email.send(message);
    return {
      ok: true,
      mode: "send",
      adapter: result.adapter,
      id: result.id,
      receipt: "accepted by provider; inbox delivery not confirmed",
    };
  } finally {
    // Anonymous telemetry is batched; flush before exit so the process does not drop it.
    await email.flush();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  loadEnvironment();
  try {
    console.log(JSON.stringify(await run({ args: process.argv.slice(2) }), null, 2));
  } catch (error) {
    // SDK errors carry a stable code and a summarized provider message; the API key is never
    // part of either. A single-adapter send failure arrives as route_error wrapping the
    // adapter_error, so print the cause too. Anything else is reported by type only.
    if (error instanceof EmailSdkError) {
      const cause = error.cause instanceof EmailSdkError ? ` <- ${error.cause.code}: ${error.cause.message}` : "";
      console.error(`${error.code}: ${error.message}${cause}`);
    } else if (error instanceof Error && /^(Usage:|Set |Replace |Fixtures )/.test(error.message)) {
      console.error(error.message);
    } else {
      console.error(`Unexpected ${error?.constructor?.name ?? "error"}; see the README troubleshooting section.`);
    }
    process.exitCode = 1;
  }
}
