# Inbound email support

`@opencoredev/email-sdk/inbound` verifies, parses, and fetches received email for every adapter whose provider can receive mail. This file records the audit behind that list: what each provider offers, how it authenticates requests, and where the SDK draws the line. Checked against official provider docs in October 2026.

Usage lives in the docs site: [Receive email](https://email-sdk.dev/docs/guides/receive-email) and the [inbound reference](https://email-sdk.dev/docs/reference/inbound).

## Supported

| Provider | Mechanism | Request authentication | SDK functions | Docs |
| --- | --- | --- | --- | --- |
| Resend | `email.received` webhook with metadata only. Bodies, headers, and attachments come from the Received emails API. | Svix: HMAC-SHA256 over `svix-id.svix-timestamp.body`, base64, `whsec_` secret, 300 s tolerance | `verifyResendInbound`, `parseResendInbound`, `fetchResendInboundEmail` | [Receiving](https://resend.com/docs/dashboard/receiving/introduction), [webhook](https://resend.com/docs/webhooks/emails/received), [API](https://resend.com/docs/api-reference/emails/retrieve-received-email) |
| Postmark | Inbound webhook (JSON) and the inbound Messages API | Not signed. Put Basic credentials in the webhook URL. | `verifyBasicAuth`, `parsePostmarkInbound`, `fetchPostmarkInboundEmail` | [Inbound webhook](https://postmarkapp.com/developer/webhooks/inbound-webhook) |
| Mailgun | Route `forward()` posts multipart/form-data. A URL ending in `mime` gets raw MIME in `body-mime`. `store()` keeps mail for 3 days. | HMAC-SHA256 over `timestamp + token`, hex, webhook signing key. The message itself is not signed. | `verifyMailgunInbound`, `parseMailgunInbound`, `fetchMailgunStoredEmail` | [Routes](https://documentation.mailgun.com/docs/mailgun/user-manual/receive-messages/routes) |
| SendGrid | Inbound Parse posts multipart/form-data, either parsed or "Send Raw" (`email` field) | Optional security policy: ECDSA P-256 / SHA-256 over `X-Twilio-Email-Event-Webhook-Timestamp + body` | `verifySendGridInbound`, `parseSendGridInbound` | [Inbound Parse](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/inbound-email), [security](https://www.twilio.com/docs/sendgrid/for-developers/parsing-email/securing-your-parse-webhooks) |
| Amazon SES | Receipt rules publish to SNS with inline content (up to 150 KB), or store in S3 and notify through SNS | SNS RSA signature, v1 SHA1withRSA or v2 SHA256withRSA. The certificate URL must be `https://sns.<region>.amazonaws.com`. | `parseSesInbound`, `verifySnsMessage`, `confirmSnsSubscription`, `fetchSesInboundFromS3` | [Notification contents](https://docs.aws.amazon.com/ses/latest/dg/receiving-email-notifications-contents.html), [SNS signatures](https://docs.aws.amazon.com/sns/latest/dg/sns-verify-signature-of-message.html) |
| Cloudflare | Email Workers `email(message)` handler with a raw MIME stream | Runs inside your Worker, so there is no HTTP request to authenticate | `parseCloudflareInbound` | [Email Workers](https://developers.cloudflare.com/email-routing/email-workers/runtime-api/) |
| Microsoft Graph | The mailbox receives the mail. Change notification subscriptions report new messages; `GET …/messages/{id}/$value` returns MIME. | `validationToken` handshake, then `clientState` on every notification | `graphValidationResponse`, `parseGraphNotifications`, `fetchGraphInboundEmail` | [Change notifications](https://learn.microsoft.com/en-us/graph/change-notifications-delivery-webhooks), [get MIME](https://learn.microsoft.com/en-us/graph/outlook-get-mime-message) |
| Mailchimp Transactional | Inbound routes post urlencoded `mandrill_events` | `X-Mandrill-Signature`: base64 HMAC-SHA1 over the webhook URL, then each POST key and value sorted by key | `verifyMandrillInbound`, `parseMandrillInbound` | [Inbound](https://mailchimp.com/developer/transactional/docs/inbound-email/), [signatures](https://mailchimp.com/developer/transactional/guides/track-respond-activity-webhooks/) |
| SparkPost | Relay webhooks post a JSON array of `msys.relay_message` | `auth_token` in `X-MessageSystems-Webhook-Token` (OAuth 2 is also offered) | `verifySparkPostInbound`, `parseSparkPostInbound` | [Relay webhooks](https://developers.sparkpost.com/api/relay-webhooks/) |
| Lettr | Inbound domains forward SparkPost relay payloads | Token in `X-MessageSystems-Webhook-Token` | `verifySparkPostInbound`, `parseLettrInbound` | [Inbound](https://docs.lettr.com/learn/inbound/introduction) |
| MailerSend | Inbound routes post `inbound.message` JSON, including the raw message | `Signature`: hex HMAC-SHA256 of the raw body | `verifyMailerSendInbound`, `parseMailerSendInbound` | [Inbound](https://developers.mailersend.com/api/v1/inbound.html), [signing](https://developers.mailersend.com/api/v1/webhooks.html) |
| Brevo | Inbound parsing webhook `{ items: [...] }`. Attachments download with `DownloadToken`. | Not signed. Configure Basic or Bearer auth on the webhook. | `verifyBasicAuth`, `verifyBearerToken`, `parseBrevoInbound` | [Inbound parsing](https://developers.brevo.com/docs/inbound-parse-webhooks) |
| MailPace | Inbound webhook JSON, including `raw` | `X-MailPace-Signature`: base64 Ed25519 over the raw body, with the domain's public key | `verifyMailPaceInbound`, `parseMailPaceInbound` | [Inbound](https://docs.mailpace.com/guide/inbound), [verification](https://docs.mailpace.com/guide/webhooks) |
| Lettermint | Inbound routes send a `message.inbound` webhook | `X-Lettermint-Signature: t=…,v1=…`: HMAC-SHA256 hex over `t.body`, with `X-Lettermint-Delivery` equal to `t`, 300 s tolerance | `verifyLettermintInbound`, `parseLettermintInbound` | [Events](https://lettermint.co/docs/platform/webhooks/events), [signing](https://lettermint.co/docs/platform/webhooks/signing) |
| Primitive | `email.received` webhook with raw MIME inline, or a signed download URL | `Primitive-Signature: t=…,v1=…`: HMAC-SHA256 hex over `t.body` | `verifyPrimitiveInbound`, `parsePrimitiveInbound` | [Payload](https://docs.primitive.dev/docs/webhook-payload), [signatures](https://docs.primitive.dev/docs/signature-verification) |
| JetEmail | Inbound webhook JSON | `X-Webhook-Signature`: hex HMAC-SHA256 over `X-Webhook-ID.X-Webhook-Timestamp.body` | `verifyJetEmailInbound`, `parseJetEmailInbound` | [Payload](https://jetemail.com/docs/inbound/webhooks/payload), [security](https://jetemail.com/docs/inbound/webhooks/security) |
| Mailtrap | An `inbound.message_received` webhook notifies you. The Inbound Messages API returns the message and a raw `.eml` URL. | `mailtrap-signature`: hex HMAC-SHA256 of the raw body | `verifyMailtrapInbound`, `fetchMailtrapInboundEmail` | [Webhooks](https://docs.mailtrap.io/inbound-email/webhooks), [get a message](https://docs.mailtrap.io/developers/inbound/messages/get-a-message) |

## Not supported

| Adapter | Why |
| --- | --- |
| Plunk | Receiving produces an internal `email.received` workflow event. Any webhook body is a template you write, with no fixed schema or signature, and Plunk drops attachments. Parse your own template's output. |
| Sequenzy | Offers reply tracking (`email.replied`, conversations API), not received messages with headers, bodies, and attachments. |
| Unosend | Its documentation lists only outbound delivery events. |
| Loops, Iterable | Marketing and transactional sending only. Replies go to a mailbox you configure. |
| Scaleway, ZeptoMail, Sendheron, Helo | Their documented APIs are send-only. |
| SMTP | A sending transport. Receiving needs an MX server or IMAP access, which is outside this SDK. |

## Notes and open gaps

- Mailtrap does not publish field names for its webhook event, so the SDK verifies the signature and leaves you to read the inbox and message IDs. Use them with `fetchMailtrapInboundEmail`.
- MailerSend's docs describe signing for webhooks in general. The SDK applies the same `Signature` scheme to inbound route posts.
- Postmark, Brevo, and unsigned SendGrid endpoints have no message signature. `handleInbound` makes you pick Basic, Bearer, or an explicit `{ none: true }`.
- The MIME parser is built in, with no dependency. See "MIME parsing" in the reference page for its limits.
