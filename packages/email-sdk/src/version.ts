// Compiled in so telemetry knows the release even after bundlers drop
// package.json. `bun run version-packages` rewrites it; version.test.ts fails
// when it drifts from package.json.
export const SDK_VERSION = "3.0.1";
