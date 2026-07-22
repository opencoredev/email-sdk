import { config } from "dotenv";

config({ path: ".env.local" });
config();

const baseUrl = process.env.RESEND_BASE_URL ?? "https://api.resend.com";
const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) {
  fail("Missing RESEND_API_KEY. Set it in your shell, .env.local, or CI secrets.");
}

const response = await fetch(`${baseUrl}/domains`, {
  headers: {
    Authorization: `Bearer ${apiKey}`,
    Accept: "application/json",
  },
});
const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;

if (!response.ok) {
  fail(`Resend domain check failed with HTTP ${response.status}: ${safeError(body)}`);
}

const domains = Array.isArray(body.data) ? body.data.filter(isRecord) : [];
const targetDomain = process.env.RESEND_TEST_DOMAIN;
const target = targetDomain
  ? domains.find((domain) => stringValue(domain.name) === targetDomain)
  : undefined;

console.log(
  JSON.stringify(
    {
      ok: true,
      provider: "resend",
      check: "domains",
      domainCount: domains.length,
      targetConfigured: Boolean(targetDomain),
      targetFound: targetDomain ? Boolean(target) : undefined,
      targetStatus: target ? stringValue(target.status) : undefined,
      targetSending: target ? sendingCapability(target) : undefined,
    },
    null,
    2,
  ),
);

if (targetDomain && !target) {
  fail("Resend authenticated successfully, but RESEND_TEST_DOMAIN was not found in the account.");
}

function sendingCapability(domain: Record<string, unknown>) {
  const capabilities = isRecord(domain.capabilities) ? domain.capabilities : undefined;
  return capabilities ? stringValue(capabilities.sending) : undefined;
}

function safeError(body: Record<string, unknown>) {
  return stringValue(body.message) ?? stringValue(body.name) ?? "Unknown error";
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}
