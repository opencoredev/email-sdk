---
"@opencoredev/email-sdk": patch
---

`defaultsPlugin` headers now yield to a message header with the same name (compared case-insensitively) instead of being sent alongside it. Before, `defaultsPlugin({ headers: [{ name: "X-Tenant", value: "a" }] })` plus a message that set `X-Tenant` failed with "does not support repeated email header names" on the 21 adapters without repeated-header support, and sent both values on the rest. Legacy name-to-value header objects from JavaScript callers now merge too.
