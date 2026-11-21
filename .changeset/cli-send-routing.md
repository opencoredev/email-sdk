---
"@opencoredev/email-sdk": minor
---

`email-sdk send` gains routing and machine-readable output flags:

- `--fallback name,name` tries more adapters, in order, after the primary definitely did not send. Fallback adapters read their configuration from environment variables only; credential flags such as `--api-key` stay with the primary.
- `--max-attempts n` sets attempts per adapter, including the first.
- `--json` prints `{ ok: true, result }` on success and `{ ok: false, error }` on failure, both on stdout, with route failures listed per adapter. Without `--json`, output is unchanged.

`--dry-run` validates the message against every adapter on the route and adds `fallback` and `maxAttempts` to the plan when they are set.
