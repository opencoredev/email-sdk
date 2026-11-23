---
"@opencoredev/email-sdk": patch
---

The one-time telemetry opt-out notice now prints only when stderr is a terminal. Servers, CI jobs, and test harnesses that assert on stderr no longer get an unsolicited multi-line message from the library. A run that skips the notice does not mark it as shown, so the first interactive run, such as the CLI in a terminal, still prints it. Telemetry itself and its opt-outs (`EMAIL_SDK_TELEMETRY=0`, `DO_NOT_TRACK=1`, `telemetry: false`) are unchanged.
