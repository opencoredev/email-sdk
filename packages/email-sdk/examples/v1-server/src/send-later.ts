import { email } from "./email.js";

await email.send(
  {
    from: "Acme <hello@acme.com>",
    to: "user@example.com",
    subject: "Your trial ends tomorrow",
    text: "Open your account to keep your work.",
    sendAt: new Date(Date.now() + 60 * 60_000),
  },
  { fallback: { adapters: [] } },
);
