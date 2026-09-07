# Durable PostgreSQL email example

A private, standalone Node.js 20+/Bun project using public Email SDK imports, `pg`, and `dotenv`. PostgreSQL owns the business transaction, unique intent, queue, leases, attempts, replay inbox, delivery facts, and suppression policy. The SDK owns one process-local provider attempt. This is **not exactly-once delivery** and is not a published package.

## Safe local quickstart

This example targets `@opencoredev/email-sdk@^1.3.0`, the forthcoming release introducing the public webhook exports it requires. Published 1.2.x is not sufficient. Until 1.3.0 is published, use the packed prerelease installation below instead of the registry install. Do not publish or change the SDK version just to run this example.

After 1.3.0 is available, copy this directory anywhere and run:

```sh
cd packages/email-sdk/examples/durable-postgres
npm install --workspaces=false --ignore-scripts
cp .env.example .env
# Only if port 5438 is not already running the task database:
docker compose up -d --wait
npm run setup
npm run enqueue -- welcome:fixture-user:v1
npm run worker
npm run status
npm run reconcile
```

The install is deliberately scoped to this private directory and does not replace the repository Bun lock. No lockfile is committed while the introducing release is unavailable; generate and retain one for your deployment after selecting the actual SDK artifact.

### Before the introducing release: install a packed SDK

From the repository root, use the current checkout's built SDK artifacts. If they are missing or stale, first coordinate with the maintainer to build the SDK; packing itself does not build it. Copy the example outside the workspace and install the tarball explicitly:

```sh
REPO="$PWD"
STANDALONE="$(mktemp -d)"
mkdir -p "$STANDALONE/example" "$STANDALONE/packs"
tar -C "$REPO/packages/email-sdk/examples/durable-postgres" \
  --exclude=node_modules --exclude=.env --exclude=.env.local \
  --exclude=package-lock.json --exclude=bun.lock -cf - . \
  | tar -C "$STANDALONE/example" -xf -
(cd "$REPO/packages/email-sdk" && npm pack --ignore-scripts --pack-destination "$STANDALONE/packs")
cd "$STANDALONE/example"
npm install --workspaces=false --ignore-scripts --no-save --package-lock=false "$STANDALONE"/packs/*.tgz
npm run check-types
cp .env.example .env
# Continue with setup/enqueue/worker/status above, using only the owned task database.
```

The current development tarball still identifies itself as 1.2.0, but contains the new exports. This explicit, local test override intentionally does not satisfy the future `^1.3.0` manifest range; `--no-save --package-lock=false` preserves the honest manifest without fabricating a release lockfile. Do not run a subsequent plain install before testing, because it will resolve the future registry range again. This verifies a real packed dependency, not a workspace symlink. It neither publishes nor versions the SDK.

`bun run setup`, `bun run enqueue -- welcome:fixture-user:v1`, `bun run worker`, `bun run status`, `bun run reconcile`, and `bun run webhook` are equivalent. The scripts run portable TypeScript with `tsx`; no runtime code depends on Bun APIs. `worker` drains currently due work and exits; schedule repeated invocations or run it under your process supervisor. It does not busy-wait for future retry dates.

The default sender is `memoryAdapter()`, with unique fixture receipt IDs across worker restarts. It never contacts a provider. The compose database trusts connections on **loopback only** and persists a named volume; this is a development configuration, not production hardening. Do not run it against an unrelated PostgreSQL instance. `docker compose down` keeps data; `docker compose down -v` deletes only this compose project's data volume.

### Live gate

No live send is needed to exercise this example or its tests. The CLI only constructs Resend when all of these are explicitly configured: `EMAIL_MODE=resend`, `EMAIL_LIVE_SEND=I_AUTHORIZE_REAL_EMAIL`, `RESEND_API_KEY`, and a non-fixture `EMAIL_ACCOUNT`. Never set the gate without permission to send real mail. The provided enqueue command deliberately uses a fixture sender; customize the message through the transaction API only after separate live authorization and sender verification. Memory jobs are scoped to `provider=memory` and cannot later be picked up by a Resend worker.

## Application API

Import the following from `src/durable.ts` in this example, not from the SDK itself:

- `database(url, schema?)` returns a pool scoped to one validated schema; `setup(pool, schema?)` creates the schema and tables. Pass the same schema to both.
- `transaction(pool, async tx => ...)` commits or rolls back one PostgreSQL transaction.
- `enqueue(tx, route, { key, message, maxAttempts? })` validates and persists an intent, returning its job UUID. Run business writes and enqueue inside the same callback. Let errors escape the callback so conflicts roll back business changes.
- `runOne(pool, route)` recovers expired leases, claims at most one due job, checks suppression, makes at most one SDK attempt, and saves the fenced outcome. It returns whether a job was claimed.
- `recover(pool)` quarantines expired inflight jobs; it never requeues them.
- `reconcile(pool, jobId, decision, evidenceReference, providerMessageId?)` makes an audited operator decision on a quarantined job.
- `webhook(pool, account, secretOrRotatedSecrets, request)` from `src/webhook.ts` authenticates raw Resend bytes and atomically persists/reduces the event before returning 200.

A `Route` contains `{ provider, account, email }`; `email` is a public `createEmailClient` client. Use an explicit adapter with no address-rewriting middleware/plugins or hidden network behavior. The worker forcibly disables fallback and passes `retry: { maxAttempts: 1 }`, a stable job UUID idempotency key, and a 20-second abort signal. It leases for 30 seconds. An adapter may ignore abort; a database token cannot fence an external provider request already in progress. Never use timeout expiry alone as proof of non-delivery.

The deliberately narrow `DurableMessage` supports bare-address `from`, nonempty `to` arrays, optional nonempty `cc`/`bcc` arrays, `subject`, and `text`. It rejects unsupported fields rather than silently losing attachments, templates, headers, scheduling, or binary objects during JSON persistence. Addresses are normalized to lowercase under this example's application policy. All supported fields, explicit provider/account, and attempt limit contribute to a deterministic fingerprint. A unique business key returns the original job for an identical payload; a conflicting payload, route, or retry policy throws. Keep keys stable across HTTP retries; a new key represents a new business intent, not a retry workaround.

## Durable state and recovery

- Jobs move `queued → inflight → accepted | failed | suppressed | needs_reconciliation`; only proven retryable `not_sent` errors requeue automatically.
- Atomic `FOR UPDATE SKIP LOCKED` claims persist an attempt, UUID claim token, and lease before any possible send. Attempt counts and exponential retry dates survive restarts. The default maximum is three claims, configurable from 1 to 10, with backoff starting at one second and capped at 60 seconds. No SDK-internal retry or automatic provider fallback is used.
- `EmailRouteError` is unwrapped only for one explicit route failure. `unknown`, partial acceptance, missing receipt IDs, unexpected adapter results, generic errors, middleware errors, and expired inflight claims are quarantined, not blindly resent. Partial receipts are retained for webhook correlation while the job remains quarantined.
- A crash before sending but after the claim is conservatively ambiguous. A crash after provider acceptance but before commit is also ambiguous. Expired tokens cannot update queue state or attach a late receipt. A database failure after a send leaves inflight work for recovery; operators must inspect provider state.
- `accepted` means provider acceptance, not delivery. Delivery facts are independently `delivered`, `bounced`, or `complained`; complaint wins over bounce, and bounce wins over delivery, regardless of event order.

Reconciliation is an **operator-only** interface, not an HTTP endpoint. First stop/fence the old worker and establish that its provider request cannot still complete, then inspect provider logs or support records using the stable idempotency key. A provider "not found" response within an eventually consistent window is not proof of non-delivery. Preserve an external audit reference without credentials, bodies, or addresses:

```sh
npm run reconcile
npm run reconcile -- JOB_UUID accepted audit-ticket-123 PROVIDER_MESSAGE_ID
npm run reconcile -- JOB_UUID not_sent audit-ticket-124
npm run reconcile -- JOB_UUID abandon audit-ticket-125
```

`accepted` attaches the verified receipt and consumes early inbox events without sending. `not_sent` requeues only with remaining attempt budget and a persisted backoff; it does not reset the attempt count. `abandon` marks the job failed. There is intentionally no automatic "retry unknown" command and no claim of exactly-once sending. Never use the `not_sent` decision for a partial result.

## Signed webhook and suppression

Set `RESEND_WEBHOOK_SECRET` and a fixed `WEBHOOK_ACCOUNT`, then run `npm run webhook`. The local HTTP listener binds `127.0.0.1:8787`, exposing only `POST /webhooks/resend`. In production terminate TLS and apply request/time/rate limits at a trusted reverse proxy. Configure the route's account from the credential mapping, never from untrusted payload fields. Use one authenticated endpoint configuration per account. The handler API accepts a secret array for rotation.

The handler uses `verifyResendWebhook` and `normalizeWebhookEvent` from the public `@opencoredev/email-sdk/webhooks` subpath, verifies the original raw body, enforces a 256 KiB body limit, and persists only normalized IDs/status—not raw payloads. Invalid signatures return 401; successful durable persistence, including replay, returns 200; failed persistence returns 503 so Resend can retry. Timestamp tolerance limits signed replay age, while PostgreSQL provides durable delivery-ID deduplication within retention.

Event uniqueness is `(provider, account, delivery_id)`. Correlation is `(provider, account, provider_message_id)`; an ID from another account or provider cannot update a job. Events arriving before the send receipt remain in an inbox. Advisory transaction locks serialize receipt attachment and event ingestion so neither side misses an early event. Replay insertion, delivery reduction, and suppression upsert commit together.

Bounce/complaint suppresses **all recipients on the correlated job**, conservatively including `to`, `cc`, and `bcc`, because this small example does not assert provider-specific per-recipient evidence. Suppressions are global across accounts and providers so a route switch cannot bypass them. Every recipient is checked immediately before every attempt; one suppressed recipient prevents the whole job from sending. No fallback route is attempted. A newly arriving suppression cannot recall a provider request already underway, and a pre-receipt event cannot suppress an unknown recipient until correlation is established. For high-volume applications use one recipient per intent and define a carefully audited policy before narrowing this conservative behavior.

## Privacy and retention

CLI logs contain event names, job UUIDs, counts, and safe state only; status excludes addresses, message bodies, business keys, evidence, provider responses, and credentials. Errors are intentionally redacted instead of printing exception causes. Add structured error categories/metrics rather than logging SQL parameter values or raw SDK exceptions. Telemetry is disabled on every example SDK client.

The database necessarily stores recipient addresses and message bodies. Use least-privilege application credentials, encrypted storage/backups, protected database access, and a retention policy appropriate to your message content. Do not treat the unauthenticated local compose database as production-ready.

No automatic retention job deletes safety records in this example. Set the following policies before deployment:

1. Retain unique business keys/fingerprints for at least the business replay horizon; deleting them permits the same intent to enqueue again. Scrub message content only after terminal state and operational investigation windows, preserving intent tombstones.
2. Keep receipt mappings and event deduplication IDs longer than the provider's maximum replay/redelivery window plus your late-event margin. Keep unresolved early inbox events until investigated; monitor age and volume. Deleting events too early can admit old replays; deleting receipts can orphan future events.
3. Preserve sticky delivery facts and global suppression independently of event-history cleanup. Do not delete suppression simply because a message or event ages out; remove it only through an authorized compliance/re-consent workflow.
4. Keep unresolved inflight/reconciliation jobs and audit references until an operator resolves them. Never use age-based cleanup to turn ambiguity into a resend. Limit reconciliation evidence to opaque external ticket references.
5. Delete child audit/attempt/receipt rows in a controlled archival transaction before deleting parent jobs, and account for backups and legal deletion requirements. Schema setup is idempotent bootstrap, not a migration framework.

## Integration verification

```sh
npm run check-types
DURABLE_TEST_DATABASE_URL=postgres://email_sdk_test@127.0.0.1:5438/email_sdk_adoption npm run test:integration
# The same node:test suite also runs with Bun:
DURABLE_TEST_DATABASE_URL=postgres://email_sdk_test@127.0.0.1:5438/email_sdk_adoption bun test ./integration/postgres.integration.ts
```

Tests use actual PostgreSQL, create a fresh `durable_test_<uuid>` schema, and drop only that schema in teardown. The URL is an explicit opt-in separate from `DATABASE_URL`. With no `DURABLE_TEST_DATABASE_URL`, all database tests are skipped; this integration filename is not a default repository `*.test.ts` discovery target. A crashed test process can leave its isolated schema for task-database cleanup. No tests contact a provider or send real mail.

Coverage includes concurrent idempotency/conflicts, validation and business transaction rollback, competing workers and locked candidates, stale leases/tokens, bounded durable retries, unknown/partial/middleware quarantine, signed webhook replay, out-of-order and pre-receipt events, provider/account isolation, persistence failure/replay, cross-route recipient suppression, and audited reconciliation.
