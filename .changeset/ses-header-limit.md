---
"@opencoredev/email-sdk": patch
---

The SES adapter now rejects a message with more than 15 headers with `EmailValidationError` before signing or sending, matching the SES v2 `Message.Headers` limit. Before, SES rejected the request after it was sent. The check runs in client validation and in a direct `adapter.send`.
