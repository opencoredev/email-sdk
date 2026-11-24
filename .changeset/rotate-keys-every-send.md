---
"@opencoredev/email-sdk": patch
---

Every built-in adapter now reads its credential on each send. SendGrid, Brevo, MailerSend, Cloudflare (REST), Iterable, Loops, MailPace, Plunk, SparkPost, Scaleway, Mailtrap, Unosend, Sequenzy, and ZeptoMail used to copy the key into their request headers when the adapter was created, so a rotated key or a getter on the options object was ignored until the client was rebuilt. They now behave like Resend, Postmark, SES, and the other adapters that already re-read it.
