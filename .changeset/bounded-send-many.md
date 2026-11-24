---
"@opencoredev/email-sdk": minor
---

`sendMany` takes a `concurrency` option: `email.sendMany(items, { concurrency: 5 })` sends up to five items at once. It defaults to `1`, so existing batches still send one at a time. Results always come back in input order with the same settled `{ ok, index, result | error }` shape. `concurrency` must be a positive integer and is not passed to each send. The new `EmailSendManyOptions` type is exported from the package root.
