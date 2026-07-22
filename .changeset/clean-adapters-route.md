---
"@opencoredev/email-sdk": major
---

Ship the v1 adapter-first SDK and CLI contract.

Breaking changes:

- Provider terminology is now adapter-first across the public SDK: configure `adapters`, `defaultAdapter`, and `fallback.adapters`; select routes with `adapter` / `withAdapter`; and implement `EmailAdapter` with a literal `name` and capability metadata. Legacy provider aliases live in the one-major `/compat` bridge for migration.
- Adapter subpath option types now use `*AdapterOptions`, and the testing entry point exports `memoryAdapter`, `failingAdapter`, and `MemoryAdapter`.
- Message-level `idempotencyKey` moves into send options, retry configuration uses `retry.maxAttempts`, fallback is explicit and stops on unknown delivery by default, and provider failures are normalized into structured `EmailSdkError` subclasses.
- `send` now returns a normalized `EmailSendResult` with adapter, accepted/rejected, id, and raw provider data; multi-message sending uses sequential `sendMany` and returns ordered settled results instead of throwing away partial success.
- Per-recipient template values now use `sendPersonalized({ message, recipients })`; adapters can declare native, expanded, or unsupported personalized capability and implement optional `sendPersonalized` for provider-native fanout.

Also included in v1:

- Shared no-network validation, explicit adapter capabilities, install-safe declaration maps, plugin and middleware hooks, and adapter-scoped helpers. Direct built-in adapter sends now enforce the same validation as `validate()` before provider calls, empty optional recipient arrays are treated as absent for narrow adapters, and SMTP preserves repeated custom headers while rejecting custom `Bcc` headers so blind-copy recipients stay RCPT-only.
- Built-in routing and whole-send timeout plugins alongside defaults, capture, and observability.
- Optional `sendAt` scheduling for adapters with native provider scheduling; invalid timestamps fail validation, unsupported adapters reject scheduling instead of queueing or sending immediately, and the CLI keeps message-level `--send-at` separate from Iterable's `--iterable-send-at` adapter option.
- Anonymous SDK and CLI telemetry with redacted error reporting, opt-outs via `EMAIL_SDK_TELEMETRY=0`, `DO_NOT_TRACK=1`, or `createEmailClient({ telemetry: false })`, and test-mode disabling. Telemetry records adapter/command names, success/failure counts, durations, recipient counts, scheduling flags, and sanitized error metadata, never content, addresses, headers, or credentials.
- Optional `/ai` entry point exposing `createEmailTools`, a client-bound `sendEmail` tool for Chat SDK and AI SDK compositions that requires approval and uses tool-call idempotency metadata.
- Optional `/react` entry point exposing `renderEmail` plus email-safe shadcn-themed layout, card, text, button, and separator components. React templates render to HTML and plain text for the normal provider-independent send pipeline without adding React to the root SDK path.
