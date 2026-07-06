// 2026-07-06: Bun test preload, wired via bunfig.toml ([test] preload). The
// in-process suite must never send live telemetry or write the user's
// ~/.config/email-sdk state, regardless of the caller's NODE_ENV or
// EMAIL_SDK_TELEMETRY — Bun's default NODE_ENV=test alone is not a guarantee.
// Telemetry tests that need capture enabled construct instances with injected
// env/fetch/configDir overrides, which bypass process.env entirely.
process.env.EMAIL_SDK_TELEMETRY = "0";
