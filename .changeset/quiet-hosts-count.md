---
"@opencoredev/email-sdk": minor
---

Telemetry events now report `installation_id_source` (`stored`, `created`, or `ephemeral`) and `hosting_platform` (detected from standard platform environment variables being set, never their values), so usage reports can tell long-lived installations apart from throwaway serverless and container identities.
