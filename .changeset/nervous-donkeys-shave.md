---
"@opencoredev/convex-email": minor
---

Support every built-in Email SDK adapter in the Convex component, including Lettermint, JetEmail, and Primitive.

Adapter configuration is now driven by a single registry (`src/shared/adapters.ts`) that declares each adapter's options, default environment variables, and which fields may be set inline. The wire validators, the `ConvexEmailAdapterConfig` union, the component's declared environment, and runtime option resolution are all derived from that registry, so a new adapter needs one registry entry plus one factory line rather than four parallel edits.

The wire format is unchanged for existing adapters. `LOOPS_TRANSACTIONAL_ID` is now declared in the component environment, so the Loops adapter can actually read it.
