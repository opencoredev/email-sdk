<p align="center">
  <img alt="Email SDK alpine landscape" src="./Background.png" width="820" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@opencoredev/email-sdk"><img alt="npm version" src="https://shieldcn.dev/npm/@opencoredev/email-sdk.svg?variant=secondary&mode=dark" /></a>
  <a href="https://github.com/opencoredev/email-sdk/stargazers"><img alt="GitHub stars" src="https://shieldcn.dev/github/opencoredev/email-sdk/stars.svg?variant=branded&mode=dark" /></a>
  <a href="https://x.com/leodev"><img alt="Follow @leodev on X" src="https://shieldcn.dev/x/follow/leodev.svg?variant=branded&mode=dark" /></a>
</p>

# Email for TypeScript apps.

Email SDK is an open-source, server-side TypeScript library for transactional email. Send with your existing provider account, validate message fields before sending, test without calling a provider, and inspect failures through common error types.

It runs in your app, not as a hosted email service. Keep your provider credentials and billing. Use a direct provider SDK if you only need its send API or provider-specific features and already have tests and error handling. Email SDK is useful when you want those checks and test tools in one place, with the option to change adapters later.

- Adapters for 23 provider APIs plus SMTP, 24 adapters total, behind one normalized message
- Retries within an adapter, plus fallback routes across adapters
- Fail-fast field-support checks before a provider drops data
- Batch personalization with per-recipient variables, plus provider-side scheduled sends
- Observability hooks for logs, metrics, and traces
- Test adapters that never call real providers
- CLI for adapter discovery, doctor checks, and dry-run sends

## Install

```bash
npm install @opencoredev/email-sdk
```

The SDK is server-side only and needs Node.js 20+ or Bun 1.1+. Keep provider API keys out of client code.

## Usage

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
  retry: { maxAttempts: 1 },
});

await email.send({
  from: "Acme <hello@acme.com>",
  to: "user@example.com",
  subject: "Welcome",
  html: "<p>It works.</p>",
});
```

Use a sender verified with your provider and a recipient you control. Follow the [runnable quickstart](https://email-sdk.dev/docs/getting-started/quickstart) for setup and a first send. A successful result records provider acceptance, not inbox delivery.

Before sending live, [check your configuration](https://email-sdk.dev/docs/reference/cli/doctor) and [test with the memory adapter](https://email-sdk.dev/docs/guides/test-email-behavior). If a send fails, [inspect its delivery state](https://email-sdk.dev/docs/guides/troubleshoot-failed-sends) before trying again. The example disables retries explicitly. If you enable them, retryable errors can retry even when acceptance is unknown; fallback stopping on unknown delivery does not prevent retries within an adapter.

## Adapters

Resend, Postmark, SendGrid, AWS SES, Mailgun, Brevo, MailerSend, SparkPost, Mailchimp, Iterable, Loops, Plunk, Mailtrap, Cloudflare, Unosend, Scaleway, ZeptoMail, MailPace, Sequenzy, JetEmail, Lettermint, Lettr, Primitive, SMTP, and a testing adapter, each imported from its own entry point. Use the adapter for your existing account; the quickstart demonstrates Resend.

## CLI

```bash
npm exec --package=@opencoredev/email-sdk -- email-sdk doctor --adapter resend
```

Default doctor checks local configuration without contacting the provider. Explicit `--live` checks authentication for supported adapters; Resend also supports a sender-domain check with `--from`. Neither proves delivery. The CLI does not load `.env` files, so export credentials into your server process. See the [doctor guide](https://email-sdk.dev/docs/reference/cli/doctor) for key-scope limits and results.

Use `email-sdk send --dry-run` to validate a message without sending it. Unlike the standalone quickstart, the CLI sends by default if you omit `--dry-run`. Diagnostics and dry runs can send anonymous telemetry unless you opt out below.

## Documentation

Full docs live at **[email-sdk.dev/docs](https://email-sdk.dev/docs)**. Good places to start:

- [Production send pipeline](https://email-sdk.dev/docs/guides/production-send-pipeline)
- [Fallbacks and retries](https://email-sdk.dev/docs/concepts/fallbacks-and-retries)
- [Field support](https://email-sdk.dev/docs/adapters/field-support)
- [How adapters are tested](https://email-sdk.dev/docs/adapters/verification): contract tests and configured auth probes are listed separately from dated run evidence; a configured check is not a passing result

## Telemetry

Email SDK collects anonymous usage analytics so we can see which adapters and CLI commands get used and how often sends succeed. The first run prints a notice with opt-out instructions.

What gets collected:

- Built-in adapter names (custom adapters are reported as `custom`) and CLI command names
- Logical send outcomes, adapter attempts, submitted and explicitly accepted message and recipient counts, uncertain outcomes, error codes, and send duration
- Total recipient counts (`to` + `cc` + `bcc`) and whether a message includes attachments (a boolean only, never the files themselves)
- Whether scheduling was requested
- SDK version, OS, Node.js version, whether the run happens in CI (and which CI provider), and whether usage comes from the library or the bundled CLI
- Redacted error reports: the error type, the Email SDK error code, and stack traces with file paths reduced to package-relative names. Error messages are scrubbed of email addresses, URLs, quoted text, long tokens, and home directories before upload.

Provider acceptance is not proof of delivery. Provider-volume counters exclude built-in test adapters, CI, and injected telemetry transports. Custom and renamed provider routes retain their counts while their names are anonymized. Retries are measured separately from logical send operations, and batch summaries do not add volume again. Telemetry is best-effort and can be disabled or blocked, so these measurements describe observed SDK usage, not every email sent through the package. See [telemetry measurement definitions](https://email-sdk.dev/docs/reference/telemetry) for counting rules and limitations.

Everything is tied to a random anonymous ID stored in `~/.config/email-sdk/telemetry.json`. Email content, subjects, addresses, headers, attachments, API keys, and any other message data are never collected.

Opt out at any time with an environment variable:

```bash
export EMAIL_SDK_TELEMETRY=0   # or DO_NOT_TRACK=1
```

or per client in code:

```ts
const client = createEmailClient({ adapters: [resend({ apiKey })], telemetry: false });
```

Telemetry is also disabled automatically when `NODE_ENV=test`.

## Sponsors

Email SDK is supported by companies that help keep provider integrations practical and maintained. Want your logo here? **[Become a sponsor →](https://github.com/sponsors/opencoredev)**

<!-- Pulled automatically from GitHub Sponsors via shieldcn.dev — logos, names, and avatars are fetched live, and new sponsors appear on their own. Tiers follow GitHub Sponsors amounts: `special=` pins the top tier ($100+/mo) into the larger "Special Sponsors" row; everyone else renders in the "Sponsors" row below. -->
<p align="center">
  <a href="https://github.com/sponsors/opencoredev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/sponsors/opencoredev.svg?special=resend,instatushq,primitivedotdev,lettermint,zernio-dev&title=false&mode=dark&preset=surface" />
      <source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/sponsors/opencoredev.svg?special=resend,instatushq,primitivedotdev,lettermint,zernio-dev&title=false&mode=light&preset=surface" />
      <img alt="Email SDK sponsors" src="https://shieldcn.dev/sponsors/opencoredev.svg?special=resend,instatushq,primitivedotdev,lettermint,zernio-dev&title=false&mode=dark&preset=surface" width="820" />
    </picture>
  </a>
</p>

<!-- Sequenzy sponsors outside GitHub Sponsors, so it can't appear in the auto grid above and is listed manually here. -->
<p align="center">
  <a href="https://www.sequenzy.com/?ref=emailsdk"><img src="./apps/fumadocs/public/og/provider-logos/sequenzy.jpeg" width="56" height="56" alt="Sequenzy logo"></a><br>
  <sub>Also sponsored by <a href="https://www.sequenzy.com/?ref=emailsdk"><b>Sequenzy</b></a> · <a href="https://email-sdk.dev/docs/adapters/sequenzy">adapter docs</a></sub>
</p>

## Star History

<p align="center">
  <a href="https://github.com/opencoredev/email-sdk/stargazers"><img alt="Star history" src="https://shieldcn.dev/chart/github/stars/opencoredev/email-sdk.svg?mode=dark" /></a>
</p>

<p align="center"><sub><a href="./LICENSE">MIT License</a> · Built by <a href="https://x.com/leodev">@leodev</a></sub></p>
