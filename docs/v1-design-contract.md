# Email SDK v1 design contract

Status: **implemented and release-validated; versioning and publication remain pending explicit approval**  
Date: 2026-07-21  
Target releases: `@opencoredev/email-sdk@1.0.0` and `@opencoredev/email-sdk-mcp@0.1.0`

This document records the implementation contract for Email SDK v1. It supersedes the individual discovery recommendations where they conflict. A scope change requires an explicit contract amendment with its API, migration, test, documentation, package, and release consequences recorded together.

## 1. Source artifacts and decision traceability

The contract synthesizes exactly five read-only discovery artifacts recovered in `/Users/leo/.jcode/scratch/email-sdk-v1-discovery-artifacts.md`:

| Artifact | Worker | Contract decisions derived from it |
|---|---|---|
| Public API audit | `monkey` | Preserve `createEmailClient` and adapter subpaths; use adapter-only vocabulary; typed routes; safe unknown-delivery fallback; no silent field loss; separate independent and personalized sends; closed errors; abortable retries |
| Chat SDK integration | `gorilla` | Add the optional `@opencoredev/email-sdk/ai` subpath; expose one bound `sendEmail` tool; use AI SDK 7 top-level approval with AI SDK 6 fallback; keep Chat SDK as a composition target rather than a package dependency |
| MCP architecture | `hippo` | Publish a standalone stdio-first MCP package; env-only credentials; shared no-network validation; immutable validation references; server-enforced elicitation; secret-safe allowlisted outputs |
| Documentation IA | `orangutan` | Preserve stable URLs where possible; organize around Get Started, Concepts, Adapters, Plugins, Integrations, Guides, Reference; compile examples; maintain machine-readable surfaces and permanent redirects |
| Compatibility and release audit | `elephant` | Archive v0.6.5 before versioning; fix Homebrew runtime, CLI dry-run, and idempotency precedence; freeze telemetry, ESM, date, personalized-send, and alias policies; add major migration notes and stronger package/release tests |

Resolved cross-artifact choices:

- **Adapter** is the only canonical v1 term. Public `provider` aliases leave the root API.
- Unknown delivery stops fallback by default. Continuing after an unknown outcome requires explicit opt-in.
- Repeated headers use a lossless array representation and capability-aware validation. The SDK never collapses duplicates silently.
- The clean v1 root does not carry legacy aliases. Legacy source compatibility is isolated in `@opencoredev/email-sdk/compat` for the v1 major only.
- `@opencoredev/email-sdk/agent-tools` remains available but deprecated. The first-class AI surface is `/ai`.
- The core SDK remains ESM-only and dependency-free at runtime. The optional `/ai` peer does not load from the root.
- MCP ships on the production-supported MCP TypeScript SDK v1 line, isolated behind an internal runtime module. An upgrade to v2 is separate work after stable release.
- Core SDK and CLI telemetry remain enabled by default with the existing environment and client opt-outs. The MCP package disables telemetry by default and offers explicit opt-in only.
- `sendAt` accepts `Date` or RFC 3339 timestamps with an explicit `Z` or numeric offset. Offset-less and implementation-dependent date strings are rejected.
- Existing unreleased minor work is folded into v1. Do not cut v0.7.0 unless the v1 initiative is explicitly descoped.

## 2. Product boundary

Email SDK v1 is a server-side, ESM-only TypeScript SDK for normalized transactional email sending through named adapters. It owns validation, routing, retry/fallback policy, hooks/plugins, normalized results, and adapter capability enforcement.

It does not own durable delivery. Applications or `@opencoredev/convex-email` own queues, persisted idempotency, recovery, and long-running workflow state.

The supported runtime floor is unchanged:

- Node.js `>=20`
- Bun `>=1.1`
- ESM imports only
- No browser or client-side credential use

## 3. Chosen public API

### 3.1 Imports and construction

The happy path stays recognizable:

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";
import { smtp } from "@opencoredev/email-sdk/smtp";

const email = createEmailClient({
  adapters: [
    resend({ apiKey: process.env.RESEND_API_KEY! }),
    smtp({
      name: "backup",
      host: process.env.SMTP_HOST!,
      auth: { user: process.env.SMTP_USER!, pass: process.env.SMTP_PASS! },
    }),
  ],
  defaultAdapter: "resend",
  retry: { maxAttempts: 3 },
  fallback: {
    adapters: ["backup"],
    onUnknownDelivery: "stop",
  },
});
```

`createEmailClient` remains synchronous. The first adapter remains the default when `defaultAdapter` is omitted. Duplicate names, an unknown default, or an unknown fallback name fail during construction.

Adapter factories return literal-name types. `createEmailClient` derives the route-name union from the provided adapters, including custom SMTP names. Route selectors and `adapter(name)` accept only that union.

The public adapter contract is:

```ts
type EmailAdapterCapabilities = {
  repeatedHeaders: boolean;
  idempotency: "native" | "message_id" | "none";
  scheduling: boolean;
  personalized: "native" | "expanded" | "unsupported";
};

type EmailAdapterValidationContext = {
  adapter: string;
  operation: "send" | "personalized";
};

type EmailAdapterContext = EmailAdapterValidationContext & {
  attempt: number;
  signal?: AbortSignal;
  idempotencyKey?: string;
  metadata?: Readonly<Record<string, unknown>>;
};

type EmailAdapter<
  Name extends string = string,
  RawClient = unknown,
  RawResult = unknown,
> = {
  readonly name: Name;
  readonly capabilities: EmailAdapterCapabilities;
  readonly raw?: RawClient;

  validate?(
    message: EmailMessage,
    context: EmailAdapterValidationContext,
  ): MaybePromise<void>;

  send(
    message: EmailMessage,
    context: EmailAdapterContext,
  ): MaybePromise<EmailSendResult<Name, RawResult>>;

  sendPersonalized?(
    input: EmailPersonalizedInput,
    context: EmailAdapterContext,
  ): MaybePromise<EmailPersonalizedResult<Name>>;
};
```

Adapter `validate` is no-network. Built-in adapters implement every provider-specific check currently split between CLI and send mapping. Custom adapters that omit it receive common and declared-capability validation only.

### 3.2 Message and attachment model

```ts
type EmailMessage = EmailEnvelope &
  ({ html: string; text?: string } | { text: string; html?: string });

type EmailAttachment = EmailAttachmentBase &
  (
    | {
        content: string | Uint8Array | ArrayBuffer | Blob;
        path?: never;
        contentEncoding?: "raw" | "base64";
      }
    | {
        path: string;
        content?: never;
        contentEncoding?: never;
      }
  );

type EmailHeader = { name: string; value: string };
```

Rules:

- A message requires `text`, `html`, or both at the type and runtime boundaries.
- An attachment has exactly one source: `content` or `path`.
- `headers` is `readonly EmailHeader[]`. The v1 root does not accept an object map because maps cannot preserve repeated names.
- Repeated names are allowed only when every candidate adapter advertises repeated-header support. Otherwise validation fails before the first provider call.
- `idempotencyKey` is not part of `EmailMessage` in the v1 root.
- `sendAt` is `Date | Rfc3339Timestamp`. Strings must include `Z` or an explicit offset.

### 3.3 Send, validation, routing, and results

```ts
const result = await email.send(
  {
    from: "Acme <hello@acme.com>",
    to: "user@example.com",
    subject: "Welcome",
    text: "Your account is ready.",
  },
  {
    adapter: "resend",
    fallback: { adapters: ["backup"], onUnknownDelivery: "stop" },
    retry: { maxAttempts: 2 },
    idempotencyKey: "welcome:user_123",
    signal,
    metadata: { source: "signup" },
  },
);

console.log(result.adapter, result.id);
```

The send options are:

```ts
type EmailSendOptions<Name extends string> = {
  adapter?: Name;
  fallback?: EmailFallbackConfig<Name>;
  retry?: EmailRetryConfig;
  signal?: AbortSignal;
  idempotencyKey?: string;
  metadata?: Readonly<Record<string, unknown>>;
};
```

The client surface is:

```ts
type EmailClient<Routes, Extension = object> = {
  readonly adapters: ReadonlyMap<RouteName<Routes>, AdapterFromRoute<Routes>>;
  readonly defaultAdapter: RouteName<Routes>;

  validate(
    message: EmailMessage,
    options?: EmailSendOptions<RouteName<Routes>>,
  ): Promise<EmailValidationResult<RouteName<Routes>>>;

  send(
    message: EmailMessage,
    options?: EmailSendOptions<RouteName<Routes>>,
  ): Promise<EmailSendResult<RouteName<Routes>>>;

  sendMany(
    items: readonly EmailSendItem<RouteName<Routes>>[],
    options?: EmailSendOptions<RouteName<Routes>>,
  ): Promise<readonly EmailSendSettledResult<RouteName<Routes>>[]>;

  sendPersonalized(
    input: EmailPersonalizedInput,
    options?: EmailSendOptions<RouteName<Routes>>,
  ): Promise<EmailPersonalizedResult<RouteName<Routes>>>;

  adapter<Name extends RouteName<Routes>>(name: Name): AdapterForName<Routes, Name>;
  withAdapter<Name extends RouteName<Routes>>(
    name: Name,
  ): Pick<EmailClient<Routes>, "validate" | "send" | "sendMany" | "sendPersonalized">;
} & Extension;
```

`validate` is the shared, public, no-network validation boundary. It runs the same common, adapter capability, adapter-specific, routing, scheduling, and personalized-send checks that `send` runs immediately before dispatch. It returns the selected adapter and warnings, or throws a typed validation/configuration error. CLI dry-run and MCP validation must call this API rather than maintaining their own field registry.

```ts
type EmailValidationResult<Name extends string> = {
  adapter: Name;
  warnings: readonly {
    code: string;
    message: string;
  }[];
};
```

`EmailSendResult` is the one normalized result shape:

```ts
type EmailSendResult<Name extends string = string, Raw = unknown> = {
  adapter: Name;
  id?: string;
  accepted?: readonly string[];
  rejected?: readonly string[];
  raw?: Raw;
};
```

The root result has `adapter` and `id`. It has no `provider` or `messageId` aliases. Adapter implementations may provide a typed `Raw` generic, but integrations must return allowlisted projections and must not forward `raw`.

### 3.4 Independent and personalized sending

`sendMany` and `sendPersonalized` are deliberately separate.

```ts
type EmailSendItem<Name extends string> = {
  message: EmailMessage;
  options?: EmailSendOptions<Name>;
};

type EmailSendSettledResult<Name extends string> =
  | { ok: true; index: number; result: EmailSendResult<Name> }
  | { ok: false; index: number; error: EmailSdkError };

type EmailPersonalizedRecipient = {
  to: EmailAddress;
  variables: Readonly<Record<string, string | number | boolean>>;
};

type EmailPersonalizedInput = {
  message: Omit<EmailMessage, "to" | "cc" | "bcc">;
  recipients: readonly EmailPersonalizedRecipient[];
};

type EmailPersonalizedResult<Name extends string> = EmailSendResult<Name> & {
  accepted: readonly string[];
  rejected: readonly string[];
};
```

```ts
await email.sendMany([
  { message: welcomeMessage, options: { idempotencyKey: "welcome:1" } },
  { message: receiptMessage, options: { idempotencyKey: "receipt:1" } },
]);
```

- `sendMany` performs independent sends sequentially in input order.
- It always returns one settled result per item with `index`, `ok`, and either `result` or a typed error.
- Item options override method-level options. Fallback arrays are replaced, not concatenated.
- Concurrency is not configurable in v1.

```ts
await email.sendPersonalized(
  {
    message: {
      from: "hello@acme.com",
      subject: "Hi %recipient.name%",
      text: "Welcome, %recipient.name%.",
    },
    recipients: [
      { to: "ada@example.com", variables: { name: "Ada" } },
      { to: "linus@example.com", variables: { name: "Linus" } },
    ],
  },
  { idempotencyKey: "campaign:42" },
);
```

- `sendPersonalized` may use a native adapter bulk API or deterministic sequential expansion.
- It resolves with accepted and rejected recipients when at least one recipient is accepted.
- It throws `EmailAllRecipientsFailedError` when none are accepted.
- Fallback is considered only when every recipient failed with `delivery: "not_sent"`.
- Any `delivery: "unknown"` outcome stops the route unless `onUnknownDelivery: "continue"` was explicitly selected.
- Per-recipient idempotency keys are derived deterministically from the caller key. They support deduplication only where the selected adapter honors idempotency.

### 3.5 Retry, fallback, abort, and idempotency

```ts
type EmailRetryConfig = {
  maxAttempts?: number;
  delay?: (attempt: number, error: EmailSdkError) => number;
  shouldRetry?: (error: EmailSdkError, attempt: number) => boolean;
};

type EmailFallbackConfig<Name extends string> = {
  adapters: readonly Name[];
  onUnknownDelivery?: "stop" | "continue";
};
```

- `maxAttempts` counts total attempts. The default is one attempt.
- Retry delay is abortable.
- Abort stops the complete route immediately. No retry or fallback occurs after abort.
- `EmailAdapterError.delivery` is `"not_sent" | "unknown"`.
- Network timeouts and failures after dispatch begins are conservatively `unknown` unless an adapter can prove otherwise.
- Fallback proceeds automatically only after `not_sent` failures.
- `onUnknownDelivery` defaults to `stop` at client and per-send levels.
- `EmailSendOptions.idempotencyKey` is the only core idempotency input. It always wins over static adapter headers. SMTP uses the resolved context key for Message-ID generation.
- The SDK never claims cross-adapter exactly-once delivery.

### 3.6 Error model

All SDK-owned failures use a closed exported code union and typed classes:

```ts
type EmailErrorCode =
  | "validation_error"
  | "adapter_not_found"
  | "adapter_error"
  | "route_error"
  | "all_recipients_failed"
  | "middleware_error"
  | "aborted";
```

Export:

- `EmailSdkError`
- `EmailValidationError`
- `EmailAdapterNotFoundError`
- `EmailAdapterError`
- `EmailRouteError`
- `EmailAllRecipientsFailedError`
- `EmailMiddlewareError`
- `EmailAbortError`
- `isRetryableEmailError`

`EmailAdapterError` includes `adapter`, `status?`, `requestId?`, `retryable`, `delivery`, and `cause`. `EmailRouteError` exposes a typed, ordered list of adapter failures. Middleware exceptions are wrapped as `EmailMiddlewareError`. Provider response bodies, secrets, URLs, paths, and arbitrary `details` are not public error fields.

### 3.7 Plugins, lifecycle, and telemetry

- Existing plugin hooks and client extension composition remain supported, renamed to adapter vocabulary where they expose route identity.
- Hook failures remain isolated from the send result. Middleware failures are typed and visible.
- The core client does not add `close`, `dispose`, or async construction because it owns no persistent resource.
- Core SDK and CLI telemetry remain enabled by default. Opt-outs remain `telemetry: false`, `EMAIL_SDK_TELEMETRY=0`, and `DO_NOT_TRACK=1`.
- The v1 telemetry contract permits only adapter names, operation names, success/failure counts, durations, stable error codes, runtime/version data, and feature flags. It forbids addresses, message content, credentials, idempotency keys, provider bodies, URLs, and filesystem paths.

## 4. Explicit breaking changes and migration contract

| v0.x surface or behavior | v1 surface or behavior | Migration |
|---|---|---|
| `providers`, `defaultProvider`, `provider`, `fallbackProviders`, `client.providers`, `client.provider()`, `withProvider()` | Adapter-only vocabulary | Rename to the corresponding adapter form. Use `/compat` temporarily if migration cannot be atomic. |
| `EmailProvider`, `EmailProviderContext`, `EmailProviderResponse`, `EmailProviderError`, `EmailProviderNotFoundError` | `EmailAdapter`, `EmailAdapterContext`, `EmailSendResult`, `EmailAdapterError`, `EmailAdapterNotFoundError` | Rename imports and field access. |
| Result `provider` and `messageId` | Result `adapter` and `id` | Replace reads. `/compat` may expose deprecated non-enumerable getters. |
| `sendBatch` and `SendBatchItem` | `sendMany` and `EmailSendItem` | Wrap each message in `{message, options?}` and read `result` instead of `response`. |
| `EmailMessage.recipientVariables` | `sendPersonalized({message, recipients})` | Convert the address-keyed map into an explicit recipient array. |
| `EmailProvider.sendBulk` | `EmailAdapter.sendPersonalized` plus declared personalized capability | Update custom adapters to the v1 adapter contract. |
| `EmailMessage.idempotencyKey` | `EmailSendOptions.idempotencyKey` | Move the field to the second argument. |
| Per-send `fallbackAdapters` | `fallback: { adapters, onUnknownDelivery? }` | Wrap fallback routes in the explicit policy object. |
| `retry.retries` and per-send `retries` | `retry.maxAttempts` and per-send `retry.maxAttempts` | Convert `retries: n` to `maxAttempts: n + 1`. |
| `headers` object or array | Lossless `EmailHeader[]` | Convert `{"X-A":"1"}` to `[{name:"X-A", value:"1"}]`. Duplicate names are validated by adapter capability. |
| Attachment may contain both `content` and `path` | Exactly one attachment source | Split or remove one source before upgrading. |
| String adapter routes and `adapter<T>(name)` assertions | Inferred literal route union | Remove unsafe generic assertions and use a registered literal name. |
| Fallback continues after any terminal error | Unknown delivery stops by default | Opt into `onUnknownDelivery: "continue"` only after accepting duplicate-delivery risk. |
| Arbitrary plugin errors may escape | `EmailMiddlewareError` | Match on the typed error code/class. |
| Implementation-dependent `sendAt` strings | `Date` or RFC 3339 with zone | Add `Z` or an explicit numeric offset. |
| CommonJS expectation | ESM-only is explicit | Migrate consumers to ESM or dynamic `import()`. No CJS build is planned. |

Compatibility policy:

- `@opencoredev/email-sdk/compat` exists for the 1.x major only.
- It translates legacy constructor/send option names, `retries`, `sendBatch`, message-level idempotency, and result aliases into the v1 internals.
- It does not preserve unsafe unknown-delivery fallback. Safety semantics remain v1 semantics unless the caller explicitly opts into continue.
- It warns once per deprecated feature in development, never in production, tests, or MCP stdio stdout.
- It is excluded from the v2 contract and documented as a migration bridge, not a stable parallel API.
- `@opencoredev/email-sdk/agent-tools` remains importable in v1 with deprecation documentation. It is not re-exported from the root and receives only critical fixes.

## 5. Chat SDK and AI SDK architecture

The product integration is documented as a Chat SDK integration, but the technical boundary is the Vercel AI SDK tool contract used by `chat/ai`.

### 5.1 Package boundary

Add `@opencoredev/email-sdk/ai` as an optional subpath of the core package.

- Do not create a separate Chat package.
- Do not add Chat SDK as a dependency or peer.
- Add `ai` as an optional peer with the tested range `^6.0.182 || ^7.0.0`.
- Use AI SDK `jsonSchema<T>` so `/ai` does not add a Zod peer.
- The root package never imports `ai`; consumers that do not import `/ai` remain unaffected.

### 5.2 Public AI exports

```ts
const emailTools = createEmailTools({
  client: email,
  from: "Acme <hello@acme.com>",
});

const result = streamText({
  model,
  tools: {
    ...createChatTools({ chat, preset: "messenger" }),
    ...emailTools.tools,
  },
  toolApproval: emailTools.toolApproval,
  experimental_toolApprovalSecret: process.env.TOOL_APPROVAL_SECRET,
});
```

Export only:

- `createEmailTools`
- `SendEmailInput`
- `SendEmailOutput`
- `emailToolApproval`

`createEmailTools({client, from})` returns:

```ts
{
  tools: { sendEmail },
  toolApproval: { sendEmail: "user-approval" },
}
```

The tool input is limited to `to`, `subject`, `text?`, and `html?`, with at least one body and `additionalProperties: false`. `from` is bound by application code. The model cannot select adapter, fallback, headers, metadata, idempotency key, schedule, attachments, cc, or bcc in v1.

The tool:

- forwards `abortSignal`
- derives `idempotencyKey` as `email-tool:${toolCallId}`
- records only safe tool-call metadata
- calls the normal `client.send` pipeline
- returns `{status:"sent", adapter, id?}`
- never returns `raw`, recipients, body, headers, metadata, or provider errors
- includes `needsApproval: true` only as the AI SDK 6 compatibility and AI SDK 7 fallback

AI SDK 7 examples must use top-level `toolApproval`, because it is the current policy API and overrides tool-level fallback. Browser/UI routes that carry approval responses must use a signing secret and render the exact recipients, subject, and body before approval. A denied send is terminal and must not be retried by instruction or application code.

## 6. MCP architecture

### 6.1 Package and runtime

Create public package `@opencoredev/email-sdk-mcp` with bin `email-sdk-mcp`.

- Initial version: `0.1.0`
- Initial transport: local stdio only
- MCP dependency: production-supported `@modelcontextprotocol/sdk@^1.29.0`
- Runtime dependencies: `@opencoredev/email-sdk@^1.0.0`, MCP SDK, and Zod
- The MCP SDK import/wiring lives behind an internal runtime module so a later v2 migration does not affect tool policy code.
- The core `email-sdk` CLI does not gain a functional `mcp` subcommand.
- stdout is JSON-RPC only. Diagnostics use stderr.

### 6.2 Startup and credential policy

- Sending is disabled by default. `EMAIL_SDK_MCP_ENABLE_SEND=1` explicitly enables `email_send` registration.
- `EMAIL_SDK_MCP_ADAPTER` is required. There is no ambient first-match adapter autodetection.
- Provider credentials are read only from the server process environment or an injected server-side secret provider.
- The MCP package does not auto-load `.env` files.
- Credentials, base URLs, auth headers, SMTP passwords, API keys, and access tokens are forbidden in tool arguments, CLI flags, resources, prompts, logs, and outputs.
- Sender identity is configured server-side. Optional recipient/domain allowlists are server policy.
- The core client is constructed with `telemetry: false`. MCP telemetry is off by default and may be explicitly enabled only for counts, durations, version, and stable error codes.

### 6.3 Tool surface and data flow

The only v1 tools are:

1. `email_configuration_status`, read-only. Returns adapter name, configuration booleans, missing environment variable names, and policy limits. It never tests credentials or returns values, prefixes, hashes, or provider auth responses.
2. `email_validate`, read-only and no-network. Validates an exact message through `client.validate`, stores the exact canonical request server-side, and returns a short-lived opaque reference plus a redacted summary.
3. `email_send`, side-effecting and absent unless enabled. Accepts only the opaque validation reference, obtains server-enforced elicitation approval, atomically consumes the reference, then sends the stored message.

Validation references are:

- random and opaque
- stored in a bounded in-memory store
- immutable after creation
- single-use
- five-minute TTL by default
- bound to adapter, sender policy, message digest, and current server policy version
- invalid after process restart
- atomically transitioned through `validated -> approving -> sending -> sent | failed | outcome_unknown`

A model-supplied `confirmed`, second call, or echoed message is never approval. `email_send` requests form elicitation that displays exact sender, recipients, subject, attachment count, adapter, and the irreversible effect. Decline, cancel, timeout, missing elicitation support, or changed policy fails closed before the adapter call.

Tool annotations are present for host UX but are never treated as authorization. `email_send` uses `readOnlyHint:false`, `destructiveHint:false`, `idempotentHint:false`, and `openWorldHint:true`.

### 6.4 MCP v1 scope and outputs

The MCP message schema allows configured sender, to/cc/bcc/reply-to, subject, and text/html within policy caps. It excludes attachments, filesystem paths, custom headers, metadata, scheduling, personalized/batch sends, tool-selected routing, fallback, retries, and base URLs.

MCP sends use one adapter and zero retries by default. An ambiguous outcome becomes terminal `outcome_unknown`. No automatic fallback occurs.

Every tool declares an output schema and returns allowlisted structured content plus a fixed human summary. `email_send` returns only `ok`, `status`, `adapter`, sanitized receipt ID, and accepted/rejected counts. Errors return only stable code, adapter, HTTP status, retryable, and `not_sent | unknown`. No output contains `raw`, body, addresses, headers, URLs, paths, tokens, provider response bodies, or causes.

Remote HTTP, MCP authorization, provider account linking, and OAuth are later work. Future documentation must say that an MCP access token authenticates the client to the MCP server and is never forwarded to an email provider.

## 7. Package map

| Workspace/package | Publish status | v1 responsibility | Dependency direction | Primary owner |
|---|---|---|---|---|
| `packages/email-sdk` / `@opencoredev/email-sdk` | Public `1.0.0` | Core API, adapters, CLI, plugins, testing, `/ai`, `/compat`, deprecated `/agent-tools` | No runtime deps in root; optional `ai` peer only for `/ai` | Core SDK owner |
| `packages/email-sdk-mcp` / `@opencoredev/email-sdk-mcp` | New public `0.1.0` | Stdio server, tool schemas, plan store, elicitation, secret-safe projection | Depends on public core SDK, MCP SDK v1, Zod; core never depends on MCP | MCP owner |
| `packages/convex-email` / `@opencoredev/convex-email` | Private, not versioned/published by Changesets | Durable queue integration and compatibility with the v1 core API | Dev and peer dependency on core; no core dependency on Convex | Convex compatibility owner |
| `packages/config` / `@email-sdk/config` | Private | Shared TypeScript/workspace configuration | No product responsibility | Build owner |
| `apps/fumadocs` | Private application | Human docs, version archives, redirects, search, raw Markdown, llms/schema/agent surfaces | Reads package metadata and source-derived manifests | Docs owner |
| `Formula/email-sdk.rb` | Published through repository/Homebrew flow | Install the npm CLI with Node, matching its shebang and engine | Updated only after npm publish | Release owner |

The core package tarball includes the TypeScript source files referenced by declaration maps, excluding tests and local-only files. Every exported subpath must resolve from an installed tarball under Node and Bun.

## 8. Documentation information architecture

Only **Get Started** is open by default. The v1 navigation is:

```text
Get Started
  Overview
  Install
  Quickstart
  Provider credentials

Concepts
  Adapter model
  Fallbacks, retries, and delivery certainty
  Send lifecycle, hooks, and middleware
  Independent, personalized, scheduled, and idempotent sending

Adapters
  Overview
  Field support
  Capability-based adapter groups
  23 adapter pages
  SMTP transport

Plugins
  Overview
  Built-in plugins
  Community plugins and adapters

Integrations
  Convex Email Ops
    Overview
    Setup
    Sending and status
    Webhooks
    Testing and recovery
  AI agents
    Overview
    Chat SDK and AI SDK email tools
    Email SDK MCP server
    Coding-agent skill
    Machine-readable docs

Guides
  Operate
    Production send pipeline
    Test email behavior
    Troubleshoot failed sends
  Migrate
    Upgrade from Email SDK 0.x to v1
    From Resend
    From Nodemailer
    From SendGrid
  Extend
    Plugin and adapter authoring/publishing guides

Reference
  Client
  Message
  Adapter contract
  Plugin API
  Community registry
  Compatibility subpath
  Telemetry and privacy
  CLI overview and command pages
  Errors overview and one page per v1 error code
```

Route policy:

- Preserve and rewrite the 49 stable current URLs identified by the IA audit.
- Permanently redirect `/docs/authentication`, `/docs/telemetry`, `/docs/plugins/writing-plugins`, and `/docs/plugins/api` to their new canonical homes.
- Split and redirect `/docs/components/convex-email` and `/docs/agents/skill`.
- Add the IA audit’s 22 pages plus an MCP integration page and an `aborted` error-code page, yielding 24 net-new pages and 79 current canonical pages.
- Snapshot v0.6.5 from the published tag under `/docs/v/0.6.5` before latest content is replaced or package versioning runs.
- Historical versions 0.2.0 through 0.6.5 are immutable after archival.
- Redirects land before old source files are removed and remain for at least the complete v1 major.

Every public surface has a documentation home:

- root client and `/compat`: Client, compatibility reference, and 0.x migration
- every adapter subpath: one adapter page and generated field support
- `/ai` and deprecated `/agent-tools`: Chat/AI tools integration page with migration guidance
- MCP package/bin/tools: MCP integration page
- CLI: overview plus `adapters`, `doctor`, and `send`
- plugins/testing: plugin/reference and test behavior guide
- Convex package: focused integration section

Examples form one progressive server-side application, carry filename labels where applicable, compile against the workspace package, never expose browser keys, and use CLI dry-run by default. Provider counts, credentials, capability tables, error codes, and current version output come from source-derived data rather than duplicated literals.

## 9. Acceptance tests and release gates

### 9.1 Core API and type contracts

- A quickstart using root plus one adapter subpath type-checks and sends through a fake adapter.
- Literal adapter names are inferred through constructor, `send`, `validate`, `adapter`, and `withAdapter`. Unknown names fail type checking.
- `adapter<T>()`-style caller casts are impossible from the v1 type surface.
- A message with neither body, or an attachment with both/neither source, fails type checking and runtime validation.
- Repeated headers reach capable adapters unchanged. A route containing an incapable adapter rejects before any send.
- `validate` performs zero network/provider-send calls and catches every common and adapter-specific case that `send` would catch.
- The CLI dry-run reproductions from the release audit exit nonzero: personalized send plus cc, Postmark two tags, Primitive two recipients, JetEmail invalid from, and unsupported scheduling.
- RFC 3339 strings with `Z` or an offset pass. Offset-less, informal, and invalid dates fail.
- Adapter authors can omit custom validation, but declared capabilities are always enforced and built-in adapters have parity between `validate` and dispatch.

### 9.2 Delivery semantics

- `maxAttempts: 1` performs exactly one adapter call. Legacy compat `retries: 2` performs three total attempts.
- Abort during adapter work or backoff produces `EmailAbortError` and performs no later retry/fallback call.
- A `not_sent` terminal error advances to configured fallback.
- An `unknown` terminal error does not advance by default.
- Explicit `onUnknownDelivery: "continue"` advances and exposes the duplicate-delivery risk in docs and hooks.
- Per-send idempotency overrides static adapter headers for Resend, JetEmail, Lettermint, Primitive, and SMTP Message-ID behavior.
- `sendMany` is sequential, ordered, settled, and has one result per item.
- `sendPersonalized` validates all recipients before dispatch, preserves native/expanded semantics, resolves partial success, throws on all-recipient failure, and follows the frozen fallback rules.
- Middleware exceptions become `EmailMiddlewareError`; route exhaustion becomes `EmailRouteError` with typed ordered failures.
- Telemetry opt-outs prevent config writes, notices, and network calls. Enabled telemetry passes the explicit field allowlist and secret/content redaction tests.

### 9.3 Chat SDK and AI SDK

- Input schema rejects a missing body and every excluded field.
- Before approval, the fake adapter has zero calls.
- An approved second pass sends exactly once with `email-tool:${toolCallId}`.
- A denied approval sends zero times and is terminal.
- Adapter failure renders an AI SDK `output-error` without leaking raw/provider data.
- Tool output contains only `status`, `adapter`, and optional `id`.
- The helper type-checks against `ai@6.0.182` and current AI SDK 7.
- Combined `chat/ai` tools and email tools type-check in one `streamText` call.
- AI SDK 6 requests approval through `needsApproval`; AI SDK 7 examples use top-level `toolApproval` and a signing secret for client-driven approval.

### 9.4 MCP

- Default startup registers status and validate but not send.
- Startup with send enabled but no explicit adapter fails clearly without exposing credential values.
- `email_configuration_status` returns only allowlisted configuration fields.
- `email_validate` calls core `validate`, performs no send, stores the exact canonical request server-side, and returns no body or address.
- Validation references expire, are single-use, cannot be modified, fail after restart, and reject adapter/policy/digest mismatch.
- Concurrent sends using one reference result in at most one adapter call.
- Missing elicitation capability, decline, cancel, or timeout produces zero adapter calls.
- Approval displays the exact stored request and cannot be satisfied by model arguments.
- Successful and failed outputs match declared schemas and contain no secrets, raw data, URLs, paths, bodies, or addresses.
- stdio stdout contains valid JSON-RPC only; all diagnostics use stderr.
- MCP uses one adapter, zero retries, no fallback, and terminates ambiguous results as `outcome_unknown`.

### 9.5 CLI, packaging, Homebrew, and adapters

- Built CLI `version`, `help`, `adapters`, `doctor`, and dry-run tests execute from installed npm tarballs under Node and Bun.
- The CLI maps `--send-at` into the shared message/options path and never silently sends immediately.
- Every package export and bin exists and imports from the installed tarball.
- Declaration maps resolve to shipped source.
- `pack:check` packs and installs both public packages, then executes smoke tests rather than relying only on `npm pack --dry-run`.
- A clean Homebrew environment depends on Node and launches the Node-shebang CLI. The formula and installation docs no longer claim that Bun is the runtime.
- All 23 adapters remain aligned across exports, CLI, docs, and generated capability data.
- Each scheduled-send and native personalized/bulk capability has live evidence before GA. If credentials are unavailable or behavior fails, the capability is marked unsupported/experimental instead of being claimed stable.

### 9.6 Documentation

- The v0.6.5 archive exists and version validation passes before v1 versioning.
- Every active page is navigated exactly once or explicitly hidden. Only Get Started opens by default. Nesting is at most three levels.
- Every old moved/split URL returns one permanent redirect with no chain or loop.
- Every HTML page has a raw Markdown counterpart and valid anchors.
- TypeScript examples compile; CLI examples run with telemetry disabled; secret/browser/deprecated-import scans pass.
- Adapter, CLI, error, telemetry, package version, and capability documentation matches source-derived truth.
- `/llms.txt`, `/docs/llms.txt`, `/llms-full.txt`, `/feeds/docs.jsonl`, `schemamap.xml`, search, agent discovery, and static agent docs include all current canonical routes.
- `apps/fumadocs` passes `bun run types:check` and `bun run build`, followed by desktop/mobile browser checks for navigation, search, versions, Copy MD, raw Markdown, breadcrumbs, next links, and redirects.

### 9.7 Final release gate

`bun run release:ci` must include and pass:

- workspace type checks
- all tests
- community and docs-version validation
- both package builds
- installed-tarball and export smoke tests
- CLI smoke tests
- docs build
- npm pack checks for core, MCP, and the private Convex package

No GA publish occurs with an unresolved P0/P1 contract failure, missing v0.6.5 archive, broken Homebrew runtime, silent CLI validation drift, secret leak, ambiguous automatic fallback, or untested claimed delivery capability.

## 10. Changeset and release strategy

- This design-contract-only document requires no changeset.
- Every user-visible SDK or CLI implementation PR carries a changeset.
- The core API/behavior implementation carries a **major** changeset for `@opencoredev/email-sdk`. Existing unreleased minor changesets remain and are absorbed into the major release.
- A separate `/ai` implementation PR carries an honest **minor** core changeset, and CLI/runtime fixes carry **patch** core changesets. The pending major still determines the final `1.0.0` version.
- Create `@opencoredev/email-sdk-mcp` at `0.0.0`, then add an initial **minor** changeset so the first published version is `0.1.0`.
- `@opencoredev/convex-email` is private and receives no changeset for compatibility-only work.
- Docs-only, workflow-only, and Homebrew pre-release fixes do not need a package changeset unless they change SDK/CLI runtime behavior. The CLI runtime/shebang fix does require a core changeset.
- Do not run a normal v0.7.0 Version packages release. Archive v0.6.5, finish implementation, then use Changesets prerelease mode for the first standard prereleases, `1.0.0-rc.0` and `0.1.0-rc.0`.
- RC feedback fixes receive honest changesets. Exit prerelease mode only after all acceptance gates pass, then publish `1.0.0` and `0.1.0` through the existing GitHub OIDC workflow.
- Run `bun run homebrew:update` only after `@opencoredev/email-sdk@1.0.0` is live on npm. Merge the generated formula update only after checksum/runtime validation.
- Major migration notes must include before/after examples for imports, constructor options, send options, result fields, errors, batch/personalized APIs, headers, attachments, retry/fallback behavior, ESM, telemetry, CLI, and `/compat`.

## 11. Implementation ownership and sequencing

Ownership is path-exclusive unless the owners coordinate a handoff. Review ownership is separate from implementation ownership.

| Workstream | Implementation ownership | Depends on | Independent validation owner |
|---|---|---|---|
| Core types and semantics | `packages/email-sdk/src/types.ts`, `core.ts`, `errors.ts`, `utils.ts`, `payloads.ts`, `smtp.ts`, adapter capability metadata and core tests | This contract | Core API validator |
| CLI and release blockers | `cli.ts`, shared validation adoption, Homebrew formula/runtime, pack/install scripts, idempotency precedence fixes | Public validation API may be landed in coordination with core | Release validator |
| Chat/AI integration | New `/ai` source, export, peer/dev dependencies, AI tests and examples; deprecation treatment for `/agent-tools` | Stable v1 client/result/error types | Chat/AI validator |
| MCP package | `packages/email-sdk-mcp/**`, workspace scripts for its build/test/pack | Stable public `validate` and send result/error contracts | MCP security validator |
| Convex compatibility | `packages/convex-email/**` and peer range | Stable v1 root types and methods | Convex validator |
| Docs and archive | `apps/fumadocs/**`, redirects, v0.6.5 snapshot, machine surfaces, migration guide | Frozen API names and package exports | Docs validator |
| Release orchestration | Changesets prerelease, final `release:ci`, npm/OIDC, post-publish Homebrew update | Every implementation and validation lane | Coordinator/release gate |

Required sequence:

1. Freeze this contract and create the route/API acceptance fixtures.
2. Archive v0.6.5 and land the shared validation boundary plus P0 correctness tests.
3. Implement core API and delivery semantics, including `/compat`.
4. In parallel after core types stabilize, implement `/ai`, MCP, CLI/release fixes, and Convex compatibility.
5. Rewrite docs against the frozen declarations, adding redirects before source moves.
6. Run independent core, Chat/AI, MCP security, Convex, docs, and release validation. Fixers own defects; validators do not silently redefine the contract.
7. Publish RC, collect early-access evidence, rerun every gate, then publish GA.

## 12. Frozen non-goals

The following are outside v1 and must not enter implementation without a contract amendment:

- Contacts, templates, broadcasts, inbound email, webhooks, or provider account management in the core SDK
- Exactly-once delivery claims or a durable queue in the core SDK
- A redesign of the Convex component beyond v1 compatibility and documentation
- Browser support or client-side provider credentials
- Concurrent `sendMany` execution or a general workflow engine
- Automatic field dropping to make incompatible adapters appear portable
- Core client pooling, `close`, async disposal, or async construction
- A separate Chat SDK package or a core dependency on Chat SDK
- Removal of deprecated `/agent-tools` during the v1 major
- MCP attachments, filesystem paths, scheduling, batch/personalized sends, custom headers, tool-selected adapters, retries, or fallback
- Remote MCP HTTP hosting, MCP OAuth/authorization, provider OAuth/account linking, or multi-tenant credential storage
- A functional `email-sdk mcp` subcommand
- MCP SDK v2 migration before its stable release and a separate compatibility review
- CommonJS output
- Rewriting historical documentation snapshots
- Publishing v1, opening a release PR, or changing Git state as part of contract synthesis

## 13. Contract completion rule

Implementation is authorized only when the coordinator accepts this document as the single source of truth. Any proposed deviation must state:

1. the exact API or behavior being changed
2. the migration consequence
3. affected package and changeset bump
4. new or changed acceptance tests
5. affected docs routes and examples
6. security and release consequences

Unrecorded deviations are defects, not implementation discretion.
