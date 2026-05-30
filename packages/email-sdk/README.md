# Email SDK

A lightweight TypeScript SDK for transactional email.

Use one client in your app, pick the adapters you actually send through, and keep provider-specific
field support visible instead of pretending every email API behaves the same way.

```bash
bun add @email-sdk/email-sdk
```

```ts
import { createEmailClient } from "@email-sdk/email-sdk";
import { resend } from "@email-sdk/email-sdk/resend";

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

- `@email-sdk/email-sdk/resend`
- `@email-sdk/email-sdk/smtp`
- `@email-sdk/email-sdk/postmark`
- `@email-sdk/email-sdk/sendgrid`
- `@email-sdk/email-sdk/ses`
- `@email-sdk/email-sdk/mailgun`
- `@email-sdk/email-sdk/mailersend`
- `@email-sdk/email-sdk/brevo`
- `@email-sdk/email-sdk/mailchimp`
- `@email-sdk/email-sdk/sparkpost`
- `@email-sdk/email-sdk/loops`
- `@email-sdk/email-sdk/plunk`
- `@email-sdk/email-sdk/mailtrap`
- `@email-sdk/email-sdk/scaleway`
- `@email-sdk/email-sdk/zeptomail`
- `@email-sdk/email-sdk/mailpace`

SMTP is built in and does not require Nodemailer.

Adapters map supported `EmailMessage` fields and reject unsupported fields instead of silently
dropping message data. Attachment `content` is treated as raw content by default; set
`contentEncoding: "base64"` when passing pre-encoded content.
