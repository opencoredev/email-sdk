---
"@opencoredev/email-sdk": minor
---

Add an experimental `native` send option for provider-specific features. Its keys are adapter names, TypeScript infers the accepted keys and shapes from the client's adapters, and each adapter in a fallback chain receives only its own entry. Resend, Postmark, SendGrid, SES, Mailgun, Brevo, and Loops get typed options for templates, tracking, streams, configuration sets, sandbox and test modes, and more. Every HTTP JSON adapter accepts a typed `body`/`headers` passthrough for fields the SDK doesn't model. Sends without `native` are unchanged.
