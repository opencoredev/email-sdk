---
"@opencoredev/email-sdk": patch
---

Read the bare address of a mailbox by skipping quoted strings and comments, so `<`, `>`, `(`, and `)` inside them no longer replace the real address. `"Ada <team>" <ada@example.test>` and `Ada (<team>) <ada@example.test>` now resolve to `ada@example.test` instead of `team`. Comments are dropped from the address too, so `Ada <ada@example.test (work)>` and `ada@example.test (work)` resolve to `ada@example.test` instead of keeping the comment, which SMTP used to reject. Mailboxes that already worked, including `Ada <ada@example.test> (work)`, resolve as before. This affects recipient-variable checks, built-in adapter validation (including the SMTP envelope), and adapters that send bare addresses (SendGrid, Postmark, Lettr, SendHeron, Mailgun).
