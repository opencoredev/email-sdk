---
"@opencoredev/email-sdk": patch
---

String addresses now resolve to the right mailbox when the display name or a comment holds angle brackets. The SDK skips quoted strings (with escaped quotes) and RFC 5322 comments, then takes the first `<...>` outside them. This is the address used by SMTP envelope validation, recipient-variable lookups and batch results (including SendGrid and Mailgun batch sends), and the Lettr and SendHeron recipient fields. Adapters that send a name and email pair (SendGrid's `from` and `to` fields, for example) still parse addresses on their own and are unchanged. The SMTP adapter now also builds its envelope (`MAIL FROM` and `RCPT TO`) from these resolved addresses instead of letting Nodemailer re-parse the original strings, so the mailbox the SDK validates is the one it delivers to.

Changed results:

- `"Ada <team>" <ada@example.test>` and `"Ada \"<x>\" L" <ada@example.test>` resolve to `ada@example.test` instead of `team` or `x`.
- `Ada (<team>) <ada@example.test>` resolves to `ada@example.test` instead of `team`.
- `Ada <ada@example.test (work)>` and `<(work)ada@example.test>` drop the comment inside the angle-addr.
- `ada@example.test (work)` and `(work) ada@example.test` resolve to `ada@example.test`, so the SMTP adapter accepts them instead of rejecting the whole string.
- A comment between two tokens counts as a space, so `ada( work )bob@example.test` resolves to `ada bob@example.test` and SMTP validation rejects it.
- A `,`, `;`, or `:` outside quotes and comments marks an address list or group, which is returned as-is. `Ada <ada@example.test>, evil@example.test` used to resolve to `ada@example.test` while the SMTP adapter delivered to both mailboxes; SMTP validation now rejects it, along with group syntax such as `Team: Ada <ada@example.test>;`.
- Nested comments and comments with a backslash, such as `Ada (a (<team>) b) <ada@example.test>`, are returned as-is and rejected by SMTP validation, because Nodemailer would read a different mailbox out of them.
- Input with an unclosed quote or comment, such as `"Ada <ada@example.test>` or `Ada <ada@example.test> (work`, is returned as-is, so validation rejects it instead of picking an address out of it.
- SMTP envelope validation also rejects `(`, `)`, `,`, `:`, `;`, `"`, and `\` in the resolved address, so bare lists like `ada@example.test,bob@example.test` and quoted local parts like `"ada"@example.test` fail before connecting.

Bare addresses, IPv6 domain literals such as `ada@[IPv6:2001:db8::1]`, `Name <a@b>`, `Ada <ada@example.test> (work)`, and unclosed or stray angle brackets resolve as before.
