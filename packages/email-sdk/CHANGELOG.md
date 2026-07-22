# @opencoredev/email-sdk

## 1.0.0

### Major Changes

- 86d54a4: Ship the v1 adapter-first SDK and CLI contract.

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

## 0.6.5

### Patch Changes

- 5614c4c: Add the Lettermint adapter (`@opencoredev/email-sdk/lettermint`) for [Lettermint](https://lettermint.co)'s European transactional email API. It posts the normalized `EmailMessage` to `POST /v1/send` over `fetch`, authenticates with the `x-lettermint-token` header, base64-encodes attachments, maps a single normalized tag plus string metadata, and forwards `idempotencyKey` as the `Idempotency-Key` header. An optional `route` targets a specific Lettermint route, and more than one tag fails fast with an `EmailValidationError`.

## 0.6.4

### Patch Changes

- 3ca47bb: Add the Primitive adapter (`@opencoredev/email-sdk/primitive`) for [Primitive](https://www.primitive.dev)'s email API for AI agents. It posts the normalized `EmailMessage` to `POST /v1/send-mail` over `fetch`, base64-encodes attachments, and forwards `idempotencyKey` as Primitive's `Idempotency-Key` header. Primitive's send API targets a single recipient and has no CC, BCC, reply-to, custom headers, tags, or metadata, so the adapter rejects those fields — and a second recipient — up front instead of silently dropping them, consistent with the SDK's fail-fast field support.

## 0.6.3

### Patch Changes

- 3c520c9: Add the JetEmail adapter (`@opencoredev/email-sdk/jetemail`) for the JetEmail transactional email API. It maps CC, BCC, reply-to, custom headers, and base64 attachments, forwards `idempotencyKey` as JetEmail's `Idempotency-Key` header, and fails fast with a clear error when `from` is missing a display name (JetEmail requires the `"Name <email>"` form). Tags and metadata are rejected before the request, consistent with the SDK's fail-fast field support.

## 0.6.2

### Patch Changes

- 9c8ff24: Reject SMTP envelope addresses and header names that contain control characters, whitespace, or angle brackets before connecting. This closes an SMTP command/header injection vector where a crafted recipient address or header name could smuggle extra SMTP commands or headers into the session.

## 0.6.1

### Patch Changes

- c80935f: Add the Convex Email component package with durable queued sends, retries, fallback adapters, idempotency, webhook ingestion, and test-mode delivery controls.

  Ship the component alongside a patch SDK release so the docs, package entrypoints, and provider surface move forward as `0.6.1` instead of a larger version jump.

## 0.6.0

### Minor Changes

- 4db1cd7: Add an official Iterable adapter for target campaign email sends.
- 2b1fbf1: Add the Sequenzy transactional email adapter, CLI support, docs, tests, and a local API-auth smoke check.

## 0.5.0

### Minor Changes

- 074d2a2: Add the Unosend REST API adapter, including the package subpath export, CLI adapter support, payload mapping, docs, and provider catalog entry.

## 0.4.0

### Minor Changes

- Add and harden the Cloudflare Email Sending adapter for the REST API, including the SDK subpath export, CLI adapter support, payload validation, response-envelope validation, tests, and docs.

### Patch Changes

- 40f787a: Run the CLI with Node as well as Bun and document the scoped npx command for one-off CLI usage.
- 2640992: Fix CLI dry-run adapter validation, CLI credential checks, batch routing aliases, and retry handling for transient transport errors.
- b9eb02f: Improve npm package metadata and README links for the Email SDK launch.
- 76fc0ef: Align provider adapters with current API docs for MailerSend response IDs, Mailtrap metadata and response IDs, Scaleway payload shape, Plunk send fields and response IDs, and Loops transactional ID validation and attachments.

## 0.3.0

### Minor Changes

- 6b59659: Add the Email SDK plugin system with built-in defaults, observability, and capture plugins, plus docs for publishing community plugins and adapter plugins.

### Patch Changes

- 17e8a6f: Add an `email-sdk version` CLI command so users and agents can verify the installed SDK and CLI version.
- 2359d77: Clarify CLI installation and one-off `bunx` usage in the package docs.

## 0.2.0

### Minor Changes

- c092005: Prepare the first public scoped release with automated versioning, npm publishing, and CLI distribution metadata.
