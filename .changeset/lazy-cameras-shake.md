---
"@opencoredev/email-sdk": patch
"@opencoredev/convex-email": patch
---

Performance and size improvements:

- The CLI now lazily imports adapters, the client, and validation helpers, so every command only loads the modules it uses (1 module instead of 26 for `adapters`/`doctor`/`version`/`help`, ~5 for `send`).
- Published `dist/` JavaScript is minified (whitespace and syntax only — identifiers are kept so stack traces stay readable), and dead `.d.ts.map` files are no longer emitted. The npm package shrinks from 37.7 kB to 29.7 kB packed (188 kB to 125 kB unpacked).
- Hot-path send overhead is reduced: per-send config and event objects are only allocated when hooks or middleware are registered, retry config is no longer copied per send, and single-adapter sends skip fallback resolution.
- The SES adapter caches the AWS SigV4 signing key per provider instance instead of re-deriving it on every send, and JSON-based adapters reuse their static request URL and headers.
- Convex Email reads the config document once per `enqueueBatch` mutation instead of once per message.
