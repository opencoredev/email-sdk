---
"@opencoredev/email-sdk": patch
---

CLI: `email-sdk send --adapter smtp` with `--user`/`--pass` now requires TLS before authenticating, matching the SDK default. Previously the CLI passed `requireTLS: false` when `--require-tls` was absent, so credentials could be sent over a plaintext connection to a server without STARTTLS. Pass `--allow-insecure-auth` (or `SMTP_ALLOW_INSECURE_AUTH=true`) to keep plaintext AUTH for a trusted local test server.
