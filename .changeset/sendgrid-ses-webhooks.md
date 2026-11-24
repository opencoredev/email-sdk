---
"@opencoredev/email-sdk": minor
---

`@opencoredev/email-sdk/webhooks` supports SendGrid and SES delivery events:

- `verifySendGridWebhook({ body, headers, publicKey })` checks a Signed Event Webhook request (ECDSA P-256 over the timestamp header and raw body) and its timestamp. It returns `false` on any bad input, and `publicKey` accepts an array for rotation.
- `normalizeWebhookEvents({ provider, body })` returns every event in a body. SendGrid batches events per request; the other providers return one. `normalizeWebhookEvent` accepts `"sendgrid"` for a one-event body and `"ses"` for an SNS notification, an EventBridge event, or a bare SES event.
- SendGrid `delivered`, `spamreport`, and hard `bounce` events map to `delivered`, `complained`, and `bounced`; SES `Delivery`, `Complaint`, and `Permanent` bounces do the same. SendGrid `providerMessageId` matches the id the SendGrid adapter returns, and SES uses `mail.messageId`.

`WebhookProvider` now includes `"sendgrid"` and `"ses"`. An exhaustive `switch` over it needs the two new cases.
