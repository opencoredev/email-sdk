---
"@opencoredev/email-sdk": patch
---

Correct anonymous usage measurements by separating logical send outcomes, adapter attempts, submitted volume, and explicit provider acceptance. Version the counting schema, replace the misleading `delivered_count` metric, exclude built-in test adapters from provider volume even when renamed, and preserve acceptance evidence when later middleware fails. Default-on telemetry and existing opt-outs remain unchanged. Document aggregation rules and why provider acceptance does not establish delivery.
