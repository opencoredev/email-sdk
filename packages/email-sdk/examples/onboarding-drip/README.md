# Onboarding drip example (experimental)

A four-email onboarding sequence built with `@opencoredev/email-sdk/workflows`:

1. Welcome email at signup.
2. A tip two days later.
3. "You're all set" as soon as the user activates, or a nudge if they haven't within three days.

Unsubscribing cancels the run at any point. `src/onboarding.ts` holds the definition and the three
calls an app makes (start at signup, an event at activation, an event at unsubscribe).
`src/onboarding.test.ts` plays the whole timeline with a manual clock, so nothing sleeps and no
email leaves the process.

From the repository root:

```bash
bun run --filter @opencoredev/email-sdk build
bun test packages/email-sdk/examples/onboarding-drip
```

In production, swap the memory store and scheduler for durable ones (see the workflows docs page)
and call `engine.resume(runId, { owner })` from your timer or queue handler, passing the timer's `owner`.
