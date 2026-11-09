---
"@opencoredev/email-sdk": minor
---

Fallback now runs by default when the primary provider definitely rejected the request. HTTP adapters report a 4xx response other than 408, 409 and 429 (for example 400, 401, 403, 404 or 422) as `delivery: "not_sent"`, so a client with `fallback` configured tries the next adapter under the default `onUnknownDelivery: "stop"` instead of throwing `EmailRouteError`. Before this change, Resend, Postmark, SES, SendGrid, Mailgun and most other HTTP adapters reported every failure as `unknown`, so fallback only ran with `onUnknownDelivery: "continue"`. Timeouts, network errors, 408, 409, 429 and 5xx responses stay `unknown` and still stop the route. If you relied on a 4xx stopping the route, pass `fallback: { adapters: [] }` for those sends.
