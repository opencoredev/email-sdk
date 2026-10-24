# Overhead benchmark

`overhead.ts` measures how much time the SDK adds to a send on top of the provider's HTTP call. Each case runs twice against the same mock `fetch`: once through `createEmailClient`, and once with the provider payload built by hand and passed straight to that `fetch`. The difference is the SDK's overhead.

There is no network. The mock `fetch` returns a fixed JSON response immediately, so the numbers cover only CPU work in this process: validation, routing, lifecycle steps, payload building, and response parsing. In a real send that work sits next to a network round trip measured in milliseconds.

Telemetry is off for the whole run. The script sets `EMAIL_SDK_TELEMETRY=0` and calls `disableTelemetry()` itself, so no PostHog request is sent and none is timed.

## Run it

From `packages/email-sdk`:

```bash
EMAIL_SDK_TELEMETRY=0 timeout 120 bun bench/overhead.ts          # table
EMAIL_SDK_TELEMETRY=0 timeout 120 bun bench/overhead.ts --json   # JSON for scripts
```

A run takes about 6 seconds. The `timeout` keeps a stuck run from holding a shared machine.

## Read the table

```text
┌───┬──────────────────────────────┬──────────┬──────────┬───────────┐
│   │ case                         │ sdk      │ raw      │ overhead  │
├───┼──────────────────────────────┼──────────┼──────────┼───────────┤
│ 0 │ resend send                  │ 1.59 µs  │ 0.83 µs  │ 0.76 µs   │
│ 1 │ postmark send                │ 1.70 µs  │ 0.80 µs  │ 0.90 µs   │
│ 2 │ sendgrid send                │ 1.91 µs  │ 0.71 µs  │ 1.20 µs   │
│ 3 │ ses send (SigV4)             │ 25.43 µs │ 53.63 µs │ -28.20 µs │
│ 4 │ ses send (raw caches key)    │ 24.88 µs │ 27.49 µs │ -2.61 µs  │
│ 5 │ resend sendMany x20          │ 35.97 µs │ 18.18 µs │ 17.79 µs  │
│ 6 │ createEmailClient + resend() │ 0.28 µs  │ 0.02 µs  │ 0.25 µs   │
└───┴──────────────────────────────┴──────────┴──────────┴───────────┘
```

That run used Bun 1.4.4 on an AMD Ryzen 9 9955HX.

- `sdk` is the median time per call through the SDK, `raw` the median for the hand-built request, and `overhead` is `sdk - raw`.
- Each case warms up, then runs 7 rounds. The table reports the median round, so one GC pause does not move it.
- `resend sendMany x20` is one `sendMany` call with 20 messages against 20 hand-built sends to the same 20 recipients.
- `createEmailClient + resend()` is the one-time cost of building a client. Its `raw` column is an empty function.

## SES rows

SigV4 signing dominates an SES send, so the two SES rows compare against different hand-written signers:

- `ses send (SigV4)` compares against a signer that derives the signing key on every request, as a minimal hand-rolled signer would. The SDK caches that key, so this row comes out negative. It shows what the cache saves, not that the SDK is faster than signing.
- `ses send (raw caches key)` is the fair comparison. The hand-written signer caches its key once per UTC day, as the SDK does. Here the SDK and the raw path do the same crypto work, and the difference sits inside run-to-run noise.

## Caveats

- These are microbenchmarks on one machine. Absolute times change with CPU, Bun version, and load. Compare `sdk` with `raw` from the same run, not across machines.
- On a shared host, other processes add noise of a few tenths of a microsecond per send and several microseconds on the SES rows. Run it two or three times before you trust a small difference.
- The mock response is tiny. Large provider responses cost more to parse on both paths.
