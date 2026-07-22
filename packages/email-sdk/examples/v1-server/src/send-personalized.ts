import { email } from "./email.js";

const result = await email.sendPersonalized(
  {
    message: {
      from: "Acme <hello@acme.com>",
      subject: "Hi %recipient.name%",
      text: "Welcome, %recipient.name%.",
    },
    recipients: [
      { to: "ada@example.com", variables: { name: "Ada" } },
      { to: "linus@example.com", variables: { name: "Linus" } },
    ],
  },
  { idempotencyKey: "onboarding:2026-07" },
);

console.log(result.adapter, result.accepted, result.rejected);
