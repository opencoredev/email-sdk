import { renderEmail } from "@opencoredev/email-sdk/react";

import { email } from "./email.js";
import { WelcomeEmail } from "./ui/email/welcome.js";

const content = await renderEmail(<WelcomeEmail name="Ada" />);

await email.send({
  from: "Acme <hello@acme.com>",
  to: "ada@example.com",
  subject: "Welcome to Acme",
  ...content,
});
