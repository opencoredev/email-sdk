---
"@opencoredev/email-sdk": major
---

Replace the hand-rolled SMTP protocol and MIME implementation with Nodemailer-backed delivery, including RFC-safe subject encoding, transfer encoding, and attachments. Add first-class CommonJS entry points alongside ESM. Telemetry remains enabled by default with the existing `telemetry: false`, `EMAIL_SDK_TELEMETRY=0`, and `DO_NOT_TRACK=1` opt-outs; events use a stable installation identifier and never include message content, addresses, or credentials. Move repository CI workflows to Tenki Cloud runners and add Node 20/22/24 package-compatibility coverage.
