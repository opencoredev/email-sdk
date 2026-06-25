<p align="center">
  <img alt="Email SDK — Send email without provider lock-in" src="./Background-with-text.png" width="820" />
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@opencoredev/email-sdk"><img alt="npm version" src="https://shieldcn.dev/npm/@opencoredev/email-sdk.svg?variant=secondary&mode=dark" /></a>
  <a href="https://github.com/opencoredev/email-sdk/stargazers"><img alt="GitHub stars" src="https://shieldcn.dev/github/opencoredev/email-sdk/stars.svg?variant=branded&mode=dark" /></a>
  <a href="https://x.com/leodev"><img alt="Follow @leodev on X" src="https://shieldcn.dev/x/follow/leodev.svg?variant=branded&mode=dark" /></a>
</p>

One TypeScript client for transactional email. Pick the providers you actually send through, add retries and fallback routes, catch unsupported fields before they are silently dropped, and keep every send observable.

- 🔌 Adapters for 19+ providers behind one normalized message
- 🔁 Retries within an adapter, plus fallback routes across adapters
- 🛟 Fail-fast field-support checks before a provider drops data
- 🔭 Observability hooks for logs, metrics, and traces
- 🧪 Test adapters that never call real providers
- ⌨️ CLI for adapter discovery, doctor checks, and dry-run sends

## Install

```bash
npm install @opencoredev/email-sdk
```

Server-side only (Node 20+ or Bun) — never expose provider API keys in client code.

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

Resend, Postmark, SendGrid, Mailgun, Brevo, MailerSend, SparkPost, Mailchimp, Iterable, Loops, Plunk, Mailtrap, Cloudflare, Unosend, Scaleway, ZeptoMail, MailPace, Sequenzy, JetEmail, SMTP, and a testing adapter — each imported from its own entry point. New here? Start with `resend` for the fastest first send.

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

## Sponsors

Email SDK is supported by companies that help keep provider integrations practical and maintained. Want your logo here? **[Become a sponsor →](https://github.com/sponsors/opencoredev)**

<!-- Pulled automatically from GitHub Sponsors via shieldcn.dev — logos, names, and avatars are fetched live, and new sponsors appear on their own. Tiers follow GitHub Sponsors amounts: `special=` pins the top tier ($100+/mo) into the larger "Special Sponsors" row; everyone else renders in the "Sponsors" row below. -->
<p align="center">
  <a href="https://github.com/sponsors/opencoredev">
    <picture>
      <source media="(prefers-color-scheme: dark)" srcset="https://shieldcn.dev/sponsors/opencoredev.svg?special=resend,instatushq,primitivedotdev&title=false&mode=dark&preset=surface" />
      <source media="(prefers-color-scheme: light)" srcset="https://shieldcn.dev/sponsors/opencoredev.svg?special=resend,instatushq,primitivedotdev&title=false&mode=light&preset=surface" />
      <img alt="Email SDK sponsors" src="https://shieldcn.dev/sponsors/opencoredev.svg?special=resend,instatushq,primitivedotdev&title=false&mode=dark&preset=surface" width="820" />
    </picture>
  </a>
</p>

<!-- Sequenzy sponsors outside GitHub Sponsors, so it can't appear in the auto grid above and is listed manually here. -->
<p align="center">
  <a href="https://www.sequenzy.com/"><img src="./apps/fumadocs/public/og/provider-logos/sequenzy.jpeg" width="56" height="56" alt="Sequenzy logo"></a><br>
  <sub>Also sponsored by <a href="https://www.sequenzy.com/"><b>Sequenzy</b></a> · <a href="https://email-sdk.dev/docs/adapters/sequenzy">adapter docs</a></sub>
</p>

## Star History

<p align="center">
  <a href="https://github.com/opencoredev/email-sdk/stargazers"><img alt="Star history" src="https://shieldcn.dev/chart/github/stars/opencoredev/email-sdk.svg?mode=dark" /></a>
</p>

<p align="center"><sub><a href="./LICENSE">MIT License</a> · Built by <a href="https://x.com/leodev">@leodev</a></sub></p>
