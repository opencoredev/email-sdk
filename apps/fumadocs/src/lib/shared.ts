export const appName = "Email SDK";
export const appDescription =
  "A TypeScript email SDK for unified email sending with Resend, SMTP, Postmark, SendGrid, Mailgun, Unosend, AWS SES, fallbacks, plugins, and a local CLI.";

// Shared description + agent constraints prepended to llms.txt / llms-full.txt so the
// machine indexes lead with what the project is and the rules for using it safely.
export const llmsOverview = `> ${appDescription}

Email SDK is an open-source TypeScript SDK (npm: \`@opencoredev/email-sdk\`) for sending transactional email through 20+ providers — Resend, SMTP, Postmark, SendGrid, Mailgun, Cloudflare Email Sending, Unosend, AWS SES, and more — behind one typed \`send()\` call with retries and compatible fallbacks. It is a library you install into a TypeScript/JavaScript app, not a hosted API or a service you sign up for.

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
