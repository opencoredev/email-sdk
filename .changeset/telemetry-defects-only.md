---
"@opencoredev/email-sdk": patch
---

Telemetry error reports now cover only bugs inside Email SDK. Provider rejections, bad credentials, rate limits, network failures, and errors from caller middleware or custom adapters are no longer sent as `$exception` events. Instead, `email sent` and `email adapter attempted` record them as a `failure_kind` (`auth`, `rate_limited`, `rejected`, `provider_error`, `network`, `caller`, or `unexpected`), along with the provider's `http_status`. Reports group by the SDK frame that failed rather than by caller code. `EmailAllRecipientsFailedError` keeps its real name in reports. Messages are also scrubbed of hostnames and IP addresses, and `sdk_version` is compiled in, so bundled apps stop reporting `unknown`.
