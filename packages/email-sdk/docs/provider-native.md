# Provider-native send options (EML-9, experimental)

Status: implemented on `swarm/eml-9-provider-native-features`, marked experimental.

The unified `EmailMessage` covers what every provider shares. It can't reach a Postmark
template, a SendGrid unsubscribe group, an SES configuration set chosen per send, or Mailgun's
test mode. Before this change the only ways around that were adapter-factory options (Postmark
`messageStream`, SES `configurationSetName`, Loops `transactionalId`, all fixed per client), or
dropping down to the provider's own SDK.

This document records what was missing, the options considered, and the design that shipped.

## 1. Survey: what was unreachable

Sources are each provider's official API reference for its single-send endpoint (links in the
adapter's `*NativeOptions` doc comment). "Today" means `origin/main` at `e7b627b`.

| Provider | High-value native features | Reachable today? |
| --- | --- | --- |
| Resend | Templates (`template: { id, variables }`, rejects `html`/`text` alongside); topic subscriptions (`topic_id`). Tracking is per domain, not per send. Batch endpoint (`/emails/batch`) with `x-batch-validation`. | No. Tags and `scheduled_at` are mapped. |
| Postmark | Templates via `/email/withTemplate` (`TemplateId` or `TemplateAlias`, `TemplateModel`, `InlineCss`); `TrackOpens`; `TrackLinks` (`None`/`HtmlAndText`/`HtmlOnly`/`TextOnly`); per-send `MessageStream`; a plain single `Tag`. | Stream only per client. Tag is forced to `name:value`. |
| SendGrid | Dynamic templates (`template_id` + per-personalization `dynamic_template_data`); `asm` unsubscribe groups; `ip_pool_name`; `batch_id` (cancel/pause scheduled sends); `mail_settings.sandbox_mode`; `tracking_settings` (click/open/subscription). | No. `custom_args` and `categories` are mapped from metadata/tags. |
| SES v2 | Stored templates (`Content.Template`: name or ARN + JSON `TemplateData`, plus headers and attachments); per-send `ConfigurationSetName`; `ListManagementOptions`; `FeedbackForwardingEmailAddress`. | Configuration set only per client. |
| Mailgun | Templates (`template`, `t:version`, `t:variables`, `t:text`); `o:tracking`, `o:tracking-clicks`, `o:tracking-opens`; `o:testmode`; `o:require-tls`; `o:skip-verification`; `o:sending-ip-pool`; `o:dkim`. | No. `v:` variables, `o:tag`, `o:deliverytime` are mapped. |
| Brevo | Templates (`templateId`, `params`); `batchId`; `messageVersions` (per-recipient variants). | No. `params` is fed from metadata only. |
| Loops | Per-send `transactionalId`; typed `dataVariables`; `addToAudience`. | `transactionalId` only per client; `addToAudience` hard-coded `false`; data variables only via metadata. |
| All HTTP providers | Any field the SDK doesn't model; extra API request headers (e.g. tracing, on-behalf-of). | No escape hatch. |

Beyond send (out of scope here, listed for a follow-up): contacts and audiences (Resend,
Loops, Brevo, SendGrid Marketing), broadcasts/campaigns, domain management, suppression lists
(Postmark, SendGrid, SES account-level suppression, Mailgun bounces/unsubscribes), template
CRUD, and batch endpoints with their own semantics. These are separate API resources with their
own lifecycles. They belong on a per-provider facade, not on `send` (see approach (b)).

## 2. Requirements

1. Type safety: options for a provider are checked against that provider's shape, and a
   client only accepts keys for adapters it actually has.
2. Fallback safety: options for adapter A must never reach adapter B.
3. Zero cost when unused: no extra allocations or work on the send hot path.
4. No breaking changes: every existing call site, `EmailSendOptions<Name>` annotation, custom
   adapter, plugin, and middleware keeps compiling and behaving the same.
5. Works for `send`, `sendMany` (batch and per item), `sendPersonalized`, and `withAdapter`.
6. An escape hatch for fields the SDK doesn't model.

## 3. Approaches considered

### (a) Typed `native` keyed by adapter name, inferred from the adapters

Each adapter carries a phantom type for its options. The client maps its adapter tuple to an
object type with one optional key per adapter that declares options.

```ts
type EmailAdapter<Name, Raw, Result, Native extends EmailNativeObject = EmailNativeObject> = {
  readonly "~native"?: Native; // type-only, never set at runtime
  send(message: EmailMessage, context: EmailAdapterContext<Native>): ...;
};

const email = createEmailClient({ adapters: [resend(...), postmark(...)] });

await email.send(message, {
  native: {
    resend: { template: { id: "welcome" } },
    postmark: { template: { alias: "welcome", model: { name: "Ada" } } },
  },
});
```

- Fallback: the object is keyed by adapter, so core hands each attempted adapter only
  `native[adapter.name]`. Leaking is structurally impossible.
- Multi-adapter clients get one call site that carries options for every provider in the
  chain, which matches how fallback is configured.
- Cost: one optional-chained property read per attempt.
- Inference needs no explicit type parameters.

### (b) `client.provider("resend")` / `client.native.resend` facade

```ts
await email.provider("resend").send({ ...message, template: { id: "welcome" } });
```

- Strong per-provider types and room for non-send methods (contacts, domains).
- It bypasses routing: a provider-specific call can't participate in fallback, so the moment
  you want a native feature you lose the SDK's main feature. Hooks, retries, and telemetry
  would need a second code path.
- `client.adapter(name)` already returns the typed adapter (and `.raw` for its config), so
  half of this exists.

Verdict: wrong tool for send options, right shape for the non-send APIs in the survey. Left as
a follow-up.

### (c) `createEmailClient<typeof adapter>` with explicit type parameters

```ts
const email = createEmailClient<[ReturnType<typeof resend>], ResendNative>({ ... });
```

- Explicit type arguments disable inference for the rest of the call, duplicate what the
  adapter array already says, and get worse with each adapter. The repo already rejects caller
  generic assertions (`type-tests/v1.ts`).

Verdict: rejected. (a) gets the same types through inference.

### (d) Raw passthrough `native: { body?, headers? }`

```ts
await email.send(message, { native: { body: { template_id: "d-123" } } });
```

- Covers every field with no SDK work.
- Untyped. A flat passthrough sent to every adapter in a chain sends SendGrid fields to
  Postmark.

Verdict: good as an escape hatch, bad as the primary API. Folded into (a) per adapter, so the
passthrough is still keyed by adapter and can't leak.

## 4. Decision: (a) with (d) inside each adapter's entry

- `EmailAdapter` gains a fourth type parameter `Native` and a type-only `"~native"` marker. The
  `~` prefix follows Standard Schema's convention for type-only members.
- `EmailSendOptions` gains `native?: Native` when `Native` is given. Clients type it as
  `EmailNativeOptions<Routes>`, a key-remapped object over the adapter union. Adapters whose `Native` is exactly the default
  (they declared nothing: SMTP, memory, plain custom adapters) get no key.
- Each provider's options type is the curated, camelCase fields plus `EmailNativePassthrough`
  (`body` shallow-merged into the JSON request, `headers` added to the API request). Mailgun
  uses multipart forms, so its passthrough is `fields`.
- Every `jsonProvider` adapter gets the passthrough at runtime, and its return type declares
  `EmailNativePassthrough`, so types match behavior.
- Core reads `options.native?.[adapter.name]` when it builds the adapter context.
- `sendMany` merges per-item `native` over the batch `native` per adapter key (an item entry
  replaces the batch entry for that adapter; other adapters keep the batch entry).

### Type pitfalls found and fixed

- **Weak-type collapse.** The first version decided "declared nothing" with
  `EmailNativeObject extends Native`. Every provider options type is all-optional, and an index
  signature is assignable to an all-optional type, so every adapter was excluded. The map
  collapsed to `{}`, and `{}` skips excess-property checks, so typos were accepted. The fix is
  an exact identity check (`IsUndeclaredNative`), and a client with no native-aware adapter
  gets `{ readonly [adapter: string]: never }` instead of `{}`. `type-tests/native.ts` pins both.
- **Backwards compatibility of `EmailSendOptions<Name>`.** With a wide default for `Native`, an
  existing `const o: EmailSendOptions<"resend"> = ...; client.send(m, o)` stopped compiling,
  because the wide map isn't assignable to a client's specific map. `Native` now defaults to
  `never`, so old annotations stay assignable to every client. Core, plugins, and middleware use
  `EmailNativeSendOptions` (`EmailSendOptions<string, EmailNativeOptionsMap>`), which
  `EmailBeforeSendEvent.options` now exposes.
- **Legacy middleware annotations.** Defaulting to `never` still left `native?: never` in the
  plain shape, so a `beforeSend` that passed `event.options` to a helper typed
  `(options: EmailSendOptions | undefined)` failed with TS2345: the event's native map isn't
  assignable to `never`. With the default, `EmailSendOptions` now leaves `native` out entirely
  (`[Native] extends [never]`), so it is exactly the pre-native shape and the wider event
  options are assignable to it. `type-tests/native.ts` compiles that middleware, an arrow
  `beforeSend` with a hand-written legacy event type, a plugin carrying it, helpers forwarding
  `EmailSendOptions` into `EmailClient`, and legacy `EmailSendItem[]` batches. The same block
  compiles against `origin/main`.

- **Assignability to the untyped `EmailClient`.** `const c: EmailClient = createEmailClient(...)`
  broke, caught by the packed-tarball consumer in `pack:check`. Two causes: the default client
  had a closed native map, and a `ClientSendOptions<Routes>` alias made TypeScript compare
  method parameters by the measured variance of `Routes` instead of structurally. Now a client
  whose route names are plain `string` (the default, or adapters such as `memoryAdapter()`
  with a non-literal name) gets the wide `EmailNativeOptionsMap`, and the method signatures
  spell out `EmailSendOptions<RouteName<Routes>, EmailNativeOptions<Routes>>` inline.
  `type-tests/native.ts` asserts typed clients stay assignable to `EmailClient`.

### Template semantics

The unified message still requires `subject` and `html` or `text`. When a native template is
set, the adapter sends the template instead of the inline body. Inline fields stay the content
for other adapters in a fallback chain, and for logs and hooks.

| Adapter | Template field | Dropped from the request |
| --- | --- | --- |
| Resend | `template` | `html`, `text` (`subject` is sent and overrides the template default unless `template.useTemplateSubject`) |
| Postmark | `template` → `/email/withTemplate` | `Subject`, `HtmlBody`, `TextBody` |
| SendGrid | `templateId` | `content` (dynamic templates take the subject from the template) |
| SES | `template` → `Content.Template` | `Content.Simple` (headers and attachments move into `Template`) |
| Mailgun | `template` | `html`, `text` (Mailgun keeps using `subject`) |
| Brevo | `templateId` | `htmlContent`, `textContent` (`subject` is sent and overrides the template subject unless `useTemplateSubject`) |
| Loops | always template-based | nothing; `transactionalId` and `dataVariables` override per send |

### Runtime cost when unused

- `core/attempts.ts` and `core/personalized.ts` each add one property to the adapter context
  object they already allocate: `native: options?.native?.[adapter.name]`. With no `native`
  option the optional chain stops at the first `?.` and the value is `undefined`. Nothing new
  is allocated.
- `mergeSendOptions` adds one `base.native && override.native` check. It only allocates when
  both sides carry native options.
- Each adapter branches once on `context.native` and returns the payload it built before this
  change. The extra spreads run only when native options are present.
- Evidence: every pre-existing adapter payload test passes unchanged, and
  `adapters.native.test.ts` asserts that an empty native entry produces a byte-identical
  request body for Resend, Postmark, SendGrid, Brevo, and Loops.

### Runtime validation

Native options are trusted TypeScript input, like the rest of `EmailSendOptions`. They are not
parsed at runtime. A JavaScript caller passing the wrong shape gets the provider's own
validation error.

## 5. Open questions

1. Template-only sends still need a placeholder `text` (or `html`). `EmailMessage` encodes
   "html or text" as a type union and `assertMessage` enforces it at runtime, so relaxing it
   for native templates changes the public message type plus validation, hooks, and telemetry
   facts. Left as is for this experimental release. `subject` is not a placeholder: Resend and
   Brevo send it as an override of the template subject.
2. Should adapter factories accept default native options (e.g. `postmark({ native: {
   trackOpens: true } })`), generalizing `messageStream`/`configurationSetName`? A custom
   `beforeSend` middleware can already inject them.
3. Non-send provider APIs (contacts, suppressions, domains) as a typed `client.provider(name)`
   facade: worth a separate issue.
4. Cloudflare, SMTP, Graph, Helo, Sendheron, JetEmail, Primitive, Lettermint, and Lettr don't
   declare native options yet. Cloudflare REST already honors the passthrough at runtime
   through `jsonProvider`, but its overloaded factory types don't expose it.
