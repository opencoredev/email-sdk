---
"@opencoredev/email-sdk": patch
---

String addresses now resolve to the right mailbox when the display name or a comment holds angle brackets. The SDK skips quoted strings (with escaped quotes) and RFC 5322 comments, then takes the first `<...>` outside them. This address is what SMTP envelope validation, recipient-variable checks, and the adapters that send bare addresses (SendGrid, Lettr, SendHeron, Mailgun) use.

Changed results:

- `"Ada <team>" <ada@example.test>` and `"Ada \"<x>\" L" <ada@example.test>` resolve to `ada@example.test` instead of `team` or `x`.
- `Ada (<team>) <ada@example.test>` and nested or escaped comments before the angle-addr resolve to `ada@example.test` instead of `team`.
- `Ada <ada@example.test (work)>` and `<(work)ada@example.test>` drop the comment inside the angle-addr.
- `ada@example.test (work)` and `(work) ada@example.test` resolve to `ada@example.test`, so the SMTP adapter accepts them instead of rejecting the whole string.
- A comment between two tokens counts as a space, so `ada( work )bob@example.test` resolves to `ada bob@example.test` and SMTP validation rejects it instead of reporting `adabob@example.test`.
- A comma outside quotes and comments marks an address list, which is returned as-is. `Ada <ada@example.test>, evil@example.test` used to resolve to `ada@example.test` while the SMTP adapter delivered to both mailboxes; SMTP validation now rejects it.
- Input with an unclosed quote or comment, such as `"Ada <ada@example.test>` or `Ada <ada@example.test> (work`, is returned as-is, so validation rejects it instead of picking an address out of it.

Bare addresses, `Name <a@b>`, `Ada <ada@example.test> (work)`, and unclosed or stray angle brackets resolve as before.
