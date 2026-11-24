---
"@opencoredev/email-sdk": patch
---

The Microsoft Graph adapter no longer requests a new OAuth token on every send when the token response has an unusable `expires_in`, such as `0`, a negative number, an empty string, or a non-numeric string. Those now fall back to a one-hour lifetime, like a missing value already did. Numeric strings such as `"3600"` still work.
