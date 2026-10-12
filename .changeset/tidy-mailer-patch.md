---
"@opencoredev/email-sdk": patch
---

Update Nodemailer to its latest compatible patch release. Telemetry now stays off when the telemetry settings file or its directory can't be read (for example, a permissions error), so an unreadable config directory can no longer override a saved opt-out.
