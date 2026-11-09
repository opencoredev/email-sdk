---
"@opencoredev/email-sdk": patch
---

Fix several send adapter defects. Mailchimp Transactional now reports per-recipient `accepted`/`rejected` and throws a permanent `not_sent` error when every recipient is rejected, instead of returning success. Lettermint and Primitive no longer join a static `idempotency-key` header with the per-send key. Graph, Plunk, and Sequenzy send the text body when `html` is an empty string. Postmark lists every accepted recipient. Scaleway returns the message ID from its `emails` response.
