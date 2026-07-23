import { createFileRoute } from "@tanstack/react-router";

import { appName, siteUrl } from "@/lib/shared";

// Markdown representation of the homepage. This is the cold-discovery path: an
// agent that lands on the site root from web search can fetch /index.md (or be
// pointed here by the markdown alternate Link header) and get structured prose
// instead of marketing HTML. Kept in sync by hand with the homepage hero copy.
const body = `# ${appName}

> An open-source TypeScript SDK for transactional email. 23 adapters. One typed SDK.

${appName} is an open-source TypeScript SDK (npm: \`@opencoredev/email-sdk\`) for sending transactional email through 22 provider APIs plus SMTP — Resend, SMTP, Postmark, SendGrid, Mailgun, Cloudflare Email Sending, Unosend, AWS SES, and more — behind one typed \`send()\` call with retries and compatible fallbacks. It is a library you install into a TypeScript/JavaScript app, **not** a hosted API or a service you sign up for. There are no credentials to obtain from us; you bring the provider keys your app already has.

## Install

\`\`\`bash
npm install @opencoredev/email-sdk
\`\`\`

## Send an email

\`\`\`ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
  retry: { maxAttempts: 2 },
});

await email.send({
  from: "Acme <hello@acme.com>",
  to: "user@example.com",
  subject: "Welcome",
  text: "Your account is ready.",
});
\`\`\`

## Why use it

- **Switch providers without rewriting your app.** Adapters import from their own entry points (\`@opencoredev/email-sdk/resend\`, \`/smtp\`, \`/ses\`, …) while every send site keeps the same typed call.
- **Retries and fallbacks.** Retry transient failures and route across compatible adapters automatically.
- **Agent-ready.** \`createEmailAgentTools(client)\` from \`@opencoredev/email-sdk/agent-tools\` returns a guarded \`send_email\` tool that runs the full validate/retry/fallback pipeline.
- **Local CLI.** \`email-sdk doctor\` and \`send --dry-run\` check configuration and test sends before going live.

## For agents

- Agent guide: ${siteUrl}/agents.md
- Authentication model: ${siteUrl}/auth.md
- Machine index: ${siteUrl}/llms.txt and ${siteUrl}/llms-full.txt
- Discovery file: ${siteUrl}/.well-known/agent.json

## Links

- Documentation: ${siteUrl}/docs
- Source: https://github.com/opencoredev/email-sdk
- Package: https://www.npmjs.com/package/@opencoredev/email-sdk
`;

export const Route = createFileRoute("/index.md")({
  server: {
    handlers: {
      GET() {
        return new Response(body, {
          headers: {
            "content-type": "text/markdown; charset=utf-8",
          },
        });
      },
    },
  },
});
