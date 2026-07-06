---
"@opencoredev/email-sdk": minor
---

Add scheduled sends via an optional `sendAt` on `EmailMessage` (a `Date` or ISO 8601 string). Seven adapters map it to their provider's native scheduling parameter: Resend (`scheduled_at`, ISO 8601), SendGrid (`send_at`, Unix seconds), Mailgun (`o:deliverytime`, RFC 2822), MailerSend (`send_at`, Unix seconds), Brevo (`scheduledAt`, ISO 8601), Mailchimp Transactional (`send_at`, UTC `YYYY-MM-DD HH:MM:SS`), and SparkPost (`options.start_time`, ISO 8601 with UTC offset). An unparseable `sendAt` fails validation before any request, and adapters without provider-side scheduling reject the field with an `EmailValidationError` instead of sending immediately — the SDK stays stateless and never queues sends itself.
