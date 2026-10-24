---
"@opencoredev/email-sdk": minor
---

Add an experimental `native` send option for provider-specific features. Its keys are adapter names, TypeScript infers the accepted keys and shapes from the client's adapters, and each adapter in a fallback chain receives only its own entry. Resend, Postmark, SendGrid, SES, Mailgun, Brevo, and Loops get typed options for templates, tracking, streams, configuration sets, sandbox and test modes, and more. Resend and Brevo template sends still send the message `subject` as an override; set `useTemplateSubject: true` to keep the template's subject. Most HTTP JSON adapters accept a typed `body`/`headers` passthrough (Mailgun: `fields`) for fields the SDK doesn't model. Existing `EmailSendOptions` annotations keep compiling, and sends without `native` are unchanged.
