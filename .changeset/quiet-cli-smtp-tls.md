---
"@opencoredev/email-sdk": patch
---

CLI: `email-sdk send --adapter smtp` with `--user`/`--pass` now requires TLS before authenticating, matching the SDK default. Previously the CLI passed `requireTLS: false` when `--require-tls` was absent, so credentials could be sent over a plaintext connection to a server without STARTTLS. Pass `--allow-insecure-auth` (or `SMTP_ALLOW_INSECURE_AUTH=true`) to keep plaintext AUTH for a trusted local test server.

The SMTP boolean flags now win over their env vars in both directions (`--allow-insecure-auth=false` overrides `SMTP_ALLOW_INSECURE_AUTH=true`), and leaving `--secure`/`SMTP_SECURE` unset keeps the SDK default of implicit TLS on port 465.
