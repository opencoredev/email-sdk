# @opencoredev/convex-email

## 3.0.0

### Minor Changes

- 92d4fb6: Add a Lettr adapter for transactional sends through Lettr's REST API. Convex Email now preserves normalized provider failure metadata and does not retry non-retryable delivery failures.

### Patch Changes

- Updated dependencies [3b46d04]
- Updated dependencies [92d4fb6]
  - @opencoredev/email-sdk@1.2.0

## 2.0.0

### Minor Changes

- e555af3: Support every built-in Email SDK adapter in the Convex component, including Lettermint, JetEmail, and Primitive.

  Adapter configuration is now driven by a single registry (`src/shared/adapters.ts`) that declares each adapter's options, default environment variables, and which fields may be set inline. The wire validators, the `ConvexEmailAdapterConfig` union, the component's declared environment, and runtime option resolution are all derived from that registry, so a new adapter needs one registry entry plus one factory line rather than four parallel edits.

  The wire format is unchanged for existing adapters. `LOOPS_TRANSACTIONAL_ID` is now declared in the component environment, so the Loops adapter can actually read it.

### Patch Changes

- Updated dependencies [6430485]
  - @opencoredev/email-sdk@1.1.0

## 1.0.1

### Patch Changes

- 1eaa029: License the SDK packages under MIT. Future cloud application code remains AGPL-3.0-only.
- Updated dependencies [1eaa029]
  - @opencoredev/email-sdk@1.0.1

## 1.0.0

### Minor Changes

- 86d54a4: Publish the Convex component with durable multi-provider email queues, reactive status, webhook history, test-mode redirection, and manual recovery for terminal failures.

### Patch Changes

- Updated dependencies [86d54a4]
  - @opencoredev/email-sdk@1.0.0

## 0.1.0

### Minor Changes

- c80935f: Add the Convex Email component package with durable queued sends, retries, fallback adapters, idempotency, webhook ingestion, and test-mode delivery controls.

  Ship the component alongside a patch SDK release so the docs, package entrypoints, and provider surface move forward as `0.6.1` instead of a larger version jump.

### Patch Changes

- Updated dependencies [c80935f]
  - @opencoredev/email-sdk@0.6.1
