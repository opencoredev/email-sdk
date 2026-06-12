---
"@opencoredev/email-sdk": minor
---

Add anonymous usage telemetry to the SDK and CLI via PostHog. The client now reports `client created` (configured adapter names), `email sent` (adapter, success/failure, error code, duration, recipient count), and the CLI reports `cli command run` (command, adapter, success). No email content, addresses, headers, or credentials are ever collected, and custom adapter names are masked as `custom`. A one-time notice with opt-out instructions is printed on first use. Opt out with `EMAIL_SDK_TELEMETRY=0`, `DO_NOT_TRACK=1`, or `createEmailClient({ telemetry: false })`; telemetry is disabled automatically when `NODE_ENV=test`.
