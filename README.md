<p align="center">
  <img alt="Email SDK — Send email without provider lock-in" src="./Background-with-text.png" width="820" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@opencoredev/email-sdk"><img alt="npm version" src="https://shieldcn.dev/npm/@opencoredev/email-sdk.svg?variant=secondary&mode=dark" /></a>
  <a href="https://github.com/opencoredev/email-sdk/stargazers"><img alt="GitHub stars" src="https://shieldcn.dev/github/opencoredev/email-sdk/stars.svg?variant=branded&mode=dark" /></a>
  <a href="https://x.com/leodev"><img alt="Follow @leodev on X" src="https://shieldcn.dev/x/follow/leodev.svg?variant=branded&mode=dark" /></a>
</p>

One TypeScript client for transactional email. Pick the providers you actually send through, add retries and fallback routes, catch unsupported fields before they are silently dropped, and keep every send observable.

- Adapters for 22 provider APIs plus SMTP, 23 adapters total, behind one normalized message
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

The SDK is server-side only and needs Node 20+ or Bun. Keep provider API keys out of client code.

## Usage

```ts
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
});

await email.send({
  from: "Acme <hello@acme.com>",
  to: "user@example.com",
  subject: "Welcome",
  html: "<p>It works.</p>",
});
```

## Adapters

Resend, Postmark, SendGrid, AWS SES, Mailgun, Brevo, MailerSend, SparkPost, Mailchimp, Iterable, Loops, Plunk, Mailtrap, Cloudflare, Unosend, Scaleway, ZeptoMail, MailPace, Sequenzy, JetEmail, Lettermint, Primitive, SMTP, and a testing adapter, each imported from its own entry point. New here? Start with `resend` for the fastest first send.

## CLI

```bash
npx email-sdk doctor --adapter resend
```

Discover adapters, validate setup, and run dry-run smoke sends from any environment.

## Documentation

Full docs live at **[email-sdk.dev/docs](https://email-sdk.dev/docs)**. Good places to start:

- [Production send pipeline](https://email-sdk.dev/docs/guides/production-send-pipeline)
- [Fallbacks and retries](https://email-sdk.dev/docs/concepts/fallbacks-and-retries)
- [Field support](https://email-sdk.dev/docs/adapters/field-support)

## Telemetry

Email SDK collects anonymous usage analytics so we can see which adapters and CLI commands get used and how often sends succeed. The first run prints a notice with opt-out instructions.

What gets collected:

- Built-in adapter names (custom adapters are reported as `custom`) and CLI command names
- Success or failure, error codes, and send duration
- Total recipient counts (`to` + `cc` + `bcc`) and whether a message includes attachments (a boolean only, never the files themselves)
- Whether scheduling was requested
- SDK version, OS, Node.js version, whether the run happens in CI (and which CI provider), and whether usage comes from the library or the bundled CLI
- Redacted error reports: the error type, the Email SDK error code, and stack traces with file paths reduced to package-relative names. Error messages are scrubbed of email addresses, URLs, quoted text, long tokens, and home directories before upload.

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
      <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/sponsors/opencoredev.svg?special=resend,instatushq,primitivedotdev,lettermint&title=false&mode=dark&preset=surface" />
      <source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/sponsors/opencoredev.svg?special=resend,instatushq,primitivedotdev,lettermint&title=false&mode=light&preset=surface" />
      <img alt="Email SDK sponsors" src="https://shieldcn.dev/sponsors/opencoredev.svg?special=resend,instatushq,primitivedotdev,lettermint&title=false&mode=dark&preset=surface" width="820" />
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

<p align="center"><sub><a href="./LICENSE">AGPL-3.0 License</a> · Built by <a href="https://x.com/leodev">@leodev</a></sub></p>
