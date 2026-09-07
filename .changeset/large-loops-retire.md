---
"@opencoredev/convex-email": patch
---

Reuse the SDK webhook normalizer for Resend, Postmark, and Mailgun, reject malformed non-object payloads, and handle Resend delivery headers case-insensitively while preserving optional application verification and generic-provider compatibility.
