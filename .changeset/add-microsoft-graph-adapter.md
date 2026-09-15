---
"@opencoredev/email-sdk": minor
---

Add Microsoft Graph adapter (`graph`) for sending email through Microsoft 365 and Azure AD using the Microsoft Graph sendMail API with OAuth 2.0 client credentials flow. The adapter supports both client secret and custom `getAccessToken` options (for managed identity, certificate credentials, or external token providers), automatic token caching with refresh skew, mailbox resolution via user ID or UPN, and optional `saveToSentItems` control. Graph enforces x- prefixed custom headers only and caps combined recipients at 1,000. The adapter is available via `@opencoredev/email-sdk/graph` and through the CLI with `--adapter graph`.
