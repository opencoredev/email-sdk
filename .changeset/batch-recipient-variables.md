---
"@opencoredev/email-sdk": minor
---

Add `recipientVariables` for per-recipient batch sends. Pass a single `to` list plus an address-keyed map of values and reference them with `%recipient.key%` tokens in `subject`, `html`, and `text`. Mailgun (`recipient-variables`) and SendGrid (one `personalizations` entry per recipient) substitute natively in a single API call; every other adapter falls back to one client-side rendered send per recipient, so the same code works on any route. Adapters can opt into native batch by implementing the new optional `EmailProvider.sendBulk`.
