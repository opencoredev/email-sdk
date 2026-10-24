---
"@opencoredev/email-sdk": patch
---

Read the bare address of a mailbox such as `"Ada <team>" <ada@example.test>` from its last `<...>`, so angle brackets inside a quoted display name no longer replace the real address. This affects recipient-variable checks, built-in adapter validation, and adapters that send bare addresses (SendGrid, Postmark, Lettr, SendHeron).
