---
"@opencoredev/email-sdk": minor
---

Add `@opencoredev/email-sdk/inbound` for receiving email. `handleInbound(request, config)` verifies and parses inbound requests from Resend, Postmark, Mailgun, SendGrid Inbound Parse, Amazon SES (SNS and S3), Microsoft Graph, Mailchimp Transactional, SparkPost, Lettr, MailerSend, Brevo, MailPace, Lettermint, Primitive, and JetEmail, and `parseCloudflareInbound` reads Cloudflare Email Workers messages. Every provider returns the same typed `InboundEmail`: addresses, multi-value headers, attachments with `read()`, threading IDs, SPF/DKIM/DMARC/spam verdicts, envelope, and the original payload. Per-provider `verify…`, `parse…`, and `fetch…` functions, plus a dependency-free MIME parser (`parseMimeMessage`), are exported too. The root entrypoint is unchanged.
