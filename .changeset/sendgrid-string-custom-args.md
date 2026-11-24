---
"@opencoredev/email-sdk": patch
---

SendGrid now sends `message.metadata` as string `custom_args`. Number, boolean, and `null` values (allowed by `EmailMessage.metadata`) used to reach SendGrid unchanged, and SendGrid rejects non-string `custom_args` with a 400. `null` becomes an empty string, matching Mailgun, Mailtrap, and the other adapters that map metadata.
