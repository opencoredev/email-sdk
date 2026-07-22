---
name: email-sdk-migrate
description: This skill should be used when the user asks to "migrate Email SDK", "upgrade email-sdk to v1", "replace provider APIs with adapters", "fix sendBatch or recipientVariables", or wants an agent to inspect an application and perform an Email SDK version migration from current source and docs.
version: 0.1.0
---

# Email SDK Migration

Migrate an application from its installed Email SDK API to the target version using the exact package declarations and current migration docs. Treat this skill as a discovery-and-edit workflow, not a static codemod.

## Establish the migration boundary

1. Read the application package manifest and lockfile to identify the installed `@opencoredev/email-sdk` version.
2. Inspect the installed package exports, README, and `dist/*.d.ts`. When working inside the Email SDK repository, inspect `packages/email-sdk/src/index.ts`, `types.ts`, `core.ts`, `errors.ts`, and `apps/fumadocs/content/docs/guides/migrate/` instead.
3. Identify the target version requested by the user. Default to the latest stable version, not an unreleased local tree, unless the task explicitly targets repository source.
4. Read the migration guide for every crossed major version. Prefer the exact installed declarations when prose and code disagree.

## Audit before editing

Run the bundled scanner from the target application root:

```bash
node path/to/email-sdk-migrate/scripts/audit.mjs .
```

Use its findings as leads, then inspect each call site. Do not blindly replace generic words such as `provider` in unrelated application code.

Also search for:

- wrapper modules that re-export Email SDK types
- queue payloads that persist old message shapes
- tests that assert legacy result aliases or error classes
- hooks, middleware, and plugins that read `event.provider`
- runtime validation schemas that duplicate old SDK fields
- docs and examples copied into the application

## Plan the change in dependency order

Apply changes in this order:

1. Update imports and explicit public types.
2. Update client construction and adapter terminology.
3. Update retry, fallback, idempotency, headers, and date shapes.
4. Replace independent batches with `sendMany`.
5. Replace per-recipient variables with `sendPersonalized`.
6. Update result handling and the closed error union.
7. Update hooks, middleware, plugins, queue payloads, tests, and local docs.
8. Remove temporary compatibility imports after all callers use the new root API.

Use `@opencoredev/email-sdk/compat` only when the application cannot migrate atomically. Record every remaining compatibility warning as migration debt. Do not leave the compat subpath as the permanent integration.

## Preserve delivery semantics

- Keep unknown-delivery fallback stopped unless duplicate delivery is explicitly acceptable.
- Preserve idempotency keys across queue retries and adapter fallback.
- Verify every fallback adapter supports all used fields and capabilities.
- Keep durable scheduling, queueing, cancellation, and persisted deduplication in the host application or a durable integration.
- Do not turn a provider-native `sendAt` migration into an in-process timer.
- Do not send live email during migration unless the user separately approves a named test recipient.

## Validate each migration phase

1. Run the application typecheck after import/type changes.
2. Run focused email tests after each behavior change.
3. Run `email-sdk doctor` for configuration checks and `email-sdk send --dry-run` for no-network message validation.
4. Add or update tests with `memoryAdapter`, `failingAdapter`, and `capturePlugin` for retry, fallback, and lifecycle behavior.
5. Finish with the repository's full build/test gate.

Report:

- installed and target versions
- files changed
- every legacy surface removed
- any remaining `/compat` usage
- behavior changes requiring product review
- validation commands and results
- live checks intentionally not run

## Resources

- `scripts/audit.mjs` scans common v0 API spellings with file and line evidence.
- The current hosted migration index is `https://email-sdk.dev/docs/guides/migrate`.
- The current package skill is `skills/email-sdk/SKILL.md`.
