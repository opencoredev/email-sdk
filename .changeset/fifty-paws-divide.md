---
"@opencoredev/email-sdk": minor
---

Add opt-in `doctor --live`, `--from`, and `--json` diagnostics with independently reported `configuration`, `authentication`, and `sender` checks. Default `doctor` stays configuration-only and makes no network request. Live probes use documented non-sending endpoints for Resend, Sequenzy, JetEmail, Primitive, Lettermint, and Lettr; Resend additionally supports paginated sender-domain readiness via `--from`, while other adapters report sender readiness as `unsupported`. Results distinguish `invalid_credentials`, `insufficient_permissions`, `inconclusive`, `rate_limited`, `network_failure`, `timeout`, `unsupported`, and `not_ready`; generic HTTP 400/422 responses are never treated as authentication success. Probes are bounded by a timeout, reject redirects and non-loopback base URL overrides, and never print credentials, response bodies, or account identifiers. The live verification scripts reuse the same probes.
