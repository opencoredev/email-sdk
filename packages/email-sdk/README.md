# Email SDK

A lightweight TypeScript SDK for transactional email.

Use one client in your app, pick the adapters you actually send through, and keep provider-specific
field support visible instead of pretending every email API behaves the same way.

```bash
bun add @opencoredev/email-sdk
```

The public npm package is `@opencoredev/email-sdk`; the unscoped `email-sdk` package is unrelated.
The command-line binary it installs is named `email-sdk`.

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
});

await email.send({
  from: "Acme <hello@acme.com>",
  to: "user@example.com",
  subject: "Welcome",
  html: "<p>It works.</p>",
});
```

Adapters:

- `@opencoredev/email-sdk/resend`
- `@opencoredev/email-sdk/smtp`
- `@opencoredev/email-sdk/postmark`
- `@opencoredev/email-sdk/sendgrid`
- `@opencoredev/email-sdk/ses`
- `@opencoredev/email-sdk/mailgun`
- `@opencoredev/email-sdk/mailersend`
- `@opencoredev/email-sdk/brevo`
- `@opencoredev/email-sdk/mailchimp`
- `@opencoredev/email-sdk/sparkpost`
- `@opencoredev/email-sdk/loops`
- `@opencoredev/email-sdk/plunk`
- `@opencoredev/email-sdk/mailtrap`
- `@opencoredev/email-sdk/scaleway`
- `@opencoredev/email-sdk/zeptomail`
- `@opencoredev/email-sdk/mailpace`

SMTP is built in and does not require Nodemailer.

Adapters map supported `EmailMessage` fields and reject unsupported fields instead of silently
dropping message data. Attachment `content` is treated as raw content by default; set
`contentEncoding: "base64"` when passing pre-encoded content.

CLI:

```bash
# one-off: no install needed
bunx --yes @opencoredev/email-sdk adapters

# after bun add @opencoredev/email-sdk
bun email-sdk doctor --adapter resend
```
