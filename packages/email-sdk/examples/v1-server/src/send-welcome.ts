import { email } from "./email.js";

const message = {
  from: "Acme <hello@acme.com>",
  to: "user@example.com",
  subject: "Welcome",
  text: "Your account is ready.",
} as const;

await email.validate(message);

const result = await email.send(message, {
  idempotencyKey: "welcome:user_123",
  metadata: { source: "signup" },
});

console.log(result.adapter, result.id);
