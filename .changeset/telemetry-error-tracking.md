---
"@opencoredev/email-sdk": minor
---

Add redacted anonymous error reporting (PostHog error tracking) plus richer usage analytics: a `source` property distinguishing CLI runs from library usage, an `email batch sent` summary event, and CI provider detection. Error reports carry only the error type, Email SDK error code, and stack frames with package-relative file names; messages are scrubbed of email addresses, URLs, quoted text, tokens, and home directories. All existing opt-outs (`EMAIL_SDK_TELEMETRY=0`, `DO_NOT_TRACK=1`, `telemetry: false`, `NODE_ENV=test`) apply unchanged.
