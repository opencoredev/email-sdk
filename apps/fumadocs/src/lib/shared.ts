export const appName = "Email SDK";
export const appDescription =
  "Email for TypeScript apps. Send transactional email with your existing provider account, validate messages, test without sending, and inspect failures in a server-side SDK.";

export const docsRoute = "/docs";
export const siteUrl = (import.meta.env.VITE_SITE_URL ?? "https://email-sdk.dev").replace(
  /\/$/,
  "",
);

// Shared description + agent constraints prepended to llms.txt / llms-full.txt so the
// machine indexes lead with what the project is and the rules for using it safely.
export const llmsOverview = `> ${appDescription}

Email SDK is an open-source, server-side TypeScript library (npm: \`@opencoredev/email-sdk\`) for transactional email. Send with your existing provider account, validate message fields, test with no-network adapters, and inspect common error types. It ships 23 provider API adapters plus SMTP, 24 adapters total, so changing providers later is optional. It is a library installed in your app, not a hosted API or a service you sign up for. Your provider still handles credentials, billing, and delivery.

## When to use Email SDK

Use it in a Node.js 20+ or Bun 1.1+ app when you want field-support validation, memory and failing test adapters, common errors, or configurable retry and fallback policies. Start with one provider. Changing adapters later keeps the message shape, but field support and provider behavior differ.

## When not to use it

- A direct provider SDK is sufficient if you only need its send API and already handle tests and failures. Prefer it for provider-specific APIs outside the common message model.
- It is not a marketing/campaign builder, CRM, or hosted email service.
- It is not for browser bundles. Do not assume edge/Workers compatibility with the server-side package.

## How AI agents should use it

Install the package, import the adapter for the provider whose credentials the app already holds, and call \`send()\`. There is nothing to authenticate against at email-sdk.dev — per-provider credentials live at ${siteUrl}/docs/getting-started/credentials. Give models the \`send_email\` tool from \`@opencoredev/email-sdk/agent-tools\`, and follow the constraints below.

## Constraints

- Server-side Node.js 20+ or Bun 1.1+ only. Keep provider credentials out of browser bundles.
- Bring your own provider credentials and keep them in environment variables. Never hardcode or log API keys, passwords, tokens, full message bodies, or recipient lists.
- Import each adapter from its own entry point (\`@opencoredev/email-sdk/resend\`, \`/smtp\`, …); do not add Nodemailer — the SDK ships its own SMTP transport.
- Configure fallback only between adapters that support the same fields (see ${siteUrl}/docs/adapters/field-support). Start with \`retry: { maxAttempts: 1 }\`. Enabled retries can repeat unknown outcomes when errors are retryable; fallback stopping on unknown delivery does not prevent those retries. Inspect uncertain outcomes before resending. Idempotency support is provider-specific, not a universal duplicate-prevention guarantee.
- A send receipt records provider acceptance, not delivery. Default doctor checks local configuration. Explicit \`doctor --live\` checks authentication for supported adapters; Resend additionally supports sender-domain readiness with \`--from\`. These checks do not prove key-level sending permission or delivery.
- The CLI does not load .env files. Export credentials into the server process. Local checks and dry runs can send anonymous telemetry; set \`EMAIL_SDK_TELEMETRY=0\` or \`DO_NOT_TRACK=1\` for network-free local validation.
- Gate agent-initiated sends behind explicit human approval. Run the CLI \`doctor\` and \`send --dry-run\` before any live send. The CLI sends if \`--dry-run\` is omitted; only the standalone first-send starter requires an explicit \`--send\` flag.`;

export const siteOgImagePath = "/og/email-sdk.png";
export const siteOgImageVersion = import.meta.env.VITE_OG_IMAGE_VERSION || "dev";
export const siteOgImageUrl = `${siteUrl}${siteOgImagePath}?v=${encodeURIComponent(
  siteOgImageVersion,
)}`;

// fill this with your actual GitHub info, for example:
export const gitConfig = {
  user: "opencoredev",
  repo: "email-sdk",
  branch: "main",
};
