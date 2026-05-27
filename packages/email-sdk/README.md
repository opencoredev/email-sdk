# Email SDK

A lightweight TypeScript SDK for unified email sending.

```bash
bun add email-sdk
```

```ts
import { createEmailClient } from "email-sdk";
import { resend } from "email-sdk/resend";

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

- `email-sdk/resend`
- `email-sdk/smtp`
- `email-sdk/postmark`
- `email-sdk/sendgrid`
- `email-sdk/mailgun`
- `email-sdk/mailersend`
- `email-sdk/brevo`
- `email-sdk/mailchimp`
- `email-sdk/sparkpost`
- `email-sdk/loops`
- `email-sdk/plunk`
- `email-sdk/mailtrap`
- `email-sdk/scaleway`
- `email-sdk/zeptomail`
- `email-sdk/mailpace`

SMTP is built in and does not require Nodemailer.

Adapters map supported `EmailMessage` fields and reject unsupported fields instead of silently dropping message data. Attachment `content` is treated as raw content by default; set `contentEncoding: "base64"` when passing pre-encoded content.
