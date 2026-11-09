---
"@opencoredev/email-sdk": minor
---

Fallback now runs by default when the primary provider definitely rejected the request. HTTP adapters report a 4xx response other than 408, 409 and 429 (for example 400, 401, 403, 404 or 422) as `delivery: "not_sent"`, so a client with `fallback` configured tries the next adapter under the default `onUnknownDelivery: "stop"` instead of throwing `EmailRouteError`. Before this change, Resend, Postmark, SES, SendGrid, Mailgun and most other HTTP adapters reported every failure as `unknown`, so fallback only ran with `onUnknownDelivery: "continue"`. Timeouts, network errors, 408, 409, 429 and 5xx responses stay `unknown` and still stop the route. When retries are on and an earlier attempt ended `unknown`, the final failure is now reported `unknown` too, even if the last attempt was a definite rejection, because the earlier attempt may have sent the message. If you relied on a 4xx stopping the route, pass `fallback: { adapters: [] }` for those sends.

CommonJS builds now share one copy of the error classes (`dist/errors.cjs`) across every entrypoint. Before, an error thrown by an adapter loaded with `require("@opencoredev/email-sdk/resend")` failed `instanceof EmailAdapterError` in the root package, so CommonJS clients lost the adapter's delivery classification and never fell back.

`require("@opencoredev/email-sdk")` works again. In 3.0.x the CommonJS root entry loaded but threw `ReferenceError: import_core is not defined` as soon as you read `createEmailClient` or any other export, because Bun dropped the module bodies of the re-export-only entry. Subpath entries such as `@opencoredev/email-sdk/resend` were not affected. ESM imports were not affected.
