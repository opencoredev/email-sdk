---
"@opencoredev/email-sdk": patch
---

Reject SMTP envelope addresses and header names that contain control characters, whitespace, or angle brackets before connecting. This closes an SMTP command/header injection vector where a crafted recipient address or header name could smuggle extra SMTP commands or headers into the session.
