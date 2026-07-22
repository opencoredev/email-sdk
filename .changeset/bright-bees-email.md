---
"@opencoredev/email-sdk-mcp": minor
---

Publish the separate `@opencoredev/email-sdk-mcp` stdio server package for safe local agent workflows. The server reads credentials only from its process environment, exposes configuration status and no-network validation by default, returns short-lived opaque validation references, disables core SDK telemetry, and enables actual sending only when `EMAIL_SDK_MCP_ENABLE_SEND=1` and the client completes MCP form elicitation approval for the exact stored email.
