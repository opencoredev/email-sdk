---
"@opencoredev/email-sdk": minor
---

Make telemetry easier to opt out of. `email-sdk telemetry disable` saves a machine-wide opt-out (`status` and `enable` are also available), `disableTelemetry()` turns telemetry off for every client in the process, and `getTelemetryStatus()` reports which setting decided the current state.
