import { email } from "./email.js";

const results = await email.sendMany([
  {
    message: {
      from: "Acme <hello@acme.com>",
      to: "ada@example.com",
      subject: "Welcome",
      text: "Your account is ready.",
    },
    options: { idempotencyKey: "welcome:ada" },
  },
  {
    message: {
      from: "Acme <billing@acme.com>",
      to: "linus@example.com",
      subject: "Receipt",
      text: "Your receipt is ready.",
    },
    options: { idempotencyKey: "receipt:linus:123" },
  },
]);

for (const item of results) {
  if (item.ok) console.log(item.index, item.result.adapter, item.result.id);
  else console.error(item.index, item.error.code);
}
