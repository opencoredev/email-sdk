export const appName = "Email SDK";
export const appDescription =
  "A TypeScript email SDK for unified email sending with Resend, SMTP, Postmark, SendGrid, Mailgun, Unosend, AWS SES, fallbacks, plugins, and a local CLI.";

// Shared description + agent constraints prepended to llms.txt / llms-full.txt so the
// machine indexes lead with what the project is and the rules for using it safely.
export const llmsOverview = `> ${appDescription}

Email SDK is an open-source TypeScript SDK (npm: \`@opencoredev/email-sdk\`) for sending transactional email through 22 provider APIs plus SMTP — Resend, SMTP, Postmark, SendGrid, Mailgun, Cloudflare Email Sending, Unosend, AWS SES, and more — behind one typed \`send()\` call with retries and compatible fallbacks. It is a library you install into a TypeScript/JavaScript app, not a hosted API or a service you sign up for.

## When to use Email SDK

Reach for it when a TypeScript/JavaScript (Node, Bun, or edge/Workers) app needs to:

- Send transactional email (receipts, verifications, alerts, password resets).
- Start on one provider but keep the option to switch or add providers later without rewriting send sites.
- Route across multiple providers with retries and compatible fallbacks.
- Give an LLM agent a guarded \`send_email\` tool that runs the same validated pipeline as the rest of the app.

## When not to use it

- You need a marketing/campaign builder or a CRM — this is transactional sending.
- You are not in a TypeScript/JavaScript runtime.
- You want a hosted email API with its own dashboard and billing — Email SDK wraps providers you already pay (Resend, SES, Postmark, SMTP, …); it is not one itself.

## How AI agents should use it

Install the package, import the adapter for the provider whose credentials the app already holds, and call \`send()\`. There is nothing to authenticate against at email-sdk.dev — per-provider credentials live in /docs/authentication. Give models the \`send_email\` tool from \`@opencoredev/email-sdk/agent-tools\`, and follow the constraints below.

## Constraints

- TypeScript/JavaScript runtimes only (Node, Bun, edge/Workers), for transactional email rather than marketing campaigns.
- Bring your own provider credentials and keep them in environment variables. Never hardcode or log API keys, passwords, tokens, full message bodies, or recipient lists.
- Import each adapter from its own entry point (\`@opencoredev/email-sdk/resend\`, \`/smtp\`, …); do not add Nodemailer — the SDK ships its own SMTP transport.
- Configure a fallback only between adapters that support the same fields (see /docs/adapters/field-support). Use idempotency keys for externally visible sends that may retry.
- Gate agent-initiated sends behind explicit human approval. Run the CLI \`doctor\` and \`send --dry-run\` before any live send.`;

export const docsRoute = "/docs";
export const siteUrl = (import.meta.env.VITE_SITE_URL ?? "https://email-sdk.dev").replace(
  /\/$/,
  "",
);
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
