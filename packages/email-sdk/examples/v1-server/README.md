# Email SDK v1 server example

This example shows the v1 server-side path without adding a standalone example package. The files import the public package entry points, define a Resend primary adapter with an SMTP fallback route, validate before sending, use `sendMany` and `sendPersonalized`, and prove fallback behavior without provider network calls.

From the repository root:

```bash
bun run --filter @opencoredev/email-sdk build
bun test packages/email-sdk/examples/v1-server/src/email.test.ts
```

Copy the environment template only if you plan to run one of the live send scripts manually:

```bash
cp packages/email-sdk/examples/v1-server/.env.example packages/email-sdk/examples/v1-server/.env
```

Do not run the live send files until the sender, credentials, and recipients are approved.

- `src/email.ts` defines a Resend primary route and named SMTP fallback.
- `src/send-welcome.ts` validates before sending with a stable idempotency key.
- `src/send-later.ts` hands a future send to a provider that supports scheduling.
- `src/send-many.ts` sends independent messages sequentially and inspects settled results.
- `src/send-personalized.ts` sends one personalized message to explicit recipients.
- `src/ui/email/welcome.tsx` defines a reusable template with email-safe shadcn-themed components.
- `src/send-react-welcome.tsx` renders that template to HTML and plain text before sending.
- `src/email.test.ts` proves fallback behavior with no provider network calls.

For the same flow in prose, read the [quickstart](https://email-sdk.dev/docs/getting-started/quickstart), [sending modes](https://email-sdk.dev/docs/concepts/sending-modes), and [production send pipeline](https://email-sdk.dev/docs/guides/production-send-pipeline).
