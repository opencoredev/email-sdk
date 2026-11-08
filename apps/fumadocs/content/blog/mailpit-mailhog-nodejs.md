# MailHog and Mailpit: Test Email Locally in Node.js

To test email from a Node.js app without sending real email, run Mailpit in Docker (`docker run -p 1025:1025 -p 8025:8025 axllent/mailpit`), point your SMTP client at `localhost:1025`, and read what arrived at `http://localhost:8025` or through Mailpit's REST API. Mailpit is the maintained replacement for MailHog. It listens on the same two ports, so most MailHog setups switch by changing the image name.

This guide covers running Mailpit, sending to it with Nodemailer and with Email SDK, checking captured messages in an automated test, and using Mailpit's Chaos feature to test how your code handles SMTP errors. Everything below was run on 2026-11-08 against `axllent/mailpit:v1.33.1`, Nodemailer 10.2 and `@opencoredev/email-sdk` 3.0.1, with `bun test`. No real email was sent.

## MailHog or Mailpit?

[MailHog](https://github.com/mailhog/MailHog) made local SMTP catching popular, but its last release is v1.0.1 from August 2020, and the project is [no longer maintained](https://github.com/mailhog/MailHog/issues/442#issuecomment-1493415258). [Mailpit](https://mailpit.axllent.org/) started as a MailHog-inspired rewrite and ships releases often (v1.33.1 came out on 2026-11-07).

For a Node app, the parts that matter:

| | MailHog | Mailpit |
| --- | --- | --- |
| SMTP port | 1025 | 1025 |
| Web UI port | 8025 | 8025 |
| Last release | v1.0.1, Aug 2020 | v1.33.1, Nov 2026 |
| Search API | `/api/v2/search` | `/api/v1/search` with filters like `to:` and `subject:` |
| Inject SMTP errors | Jim, its chaos monkey | Chaos triggers, set at runtime through the API |
| HTML client compatibility check | No | Yes |

Because the ports match, an app that sends to MailHog today will send to Mailpit with no code change. Test code that reads MailHog's `/api/v2` endpoints needs rewriting, since Mailpit's API is different.

## Run Mailpit

```bash
docker run -d --name mailpit -p 1025:1025 -p 8025:8025 axllent/mailpit
```

Open `http://localhost:8025` to see the inbox. In a Compose file next to your app:

```yaml title="compose.yaml"
services:
  mailpit:
    image: axllent/mailpit
    ports:
      - "1025:1025"
      - "8025:8025"
```

Mailpit also ships as a single binary (`brew install mailpit` on macOS) if you'd rather not run Docker. Pin a version tag such as `axllent/mailpit:v1.33.1` in CI so a new release can't change your tests.

## Send to Mailpit with Nodemailer

Mailpit has no TLS and no auth by default, so connect in plain text:

```ts title="mail.ts"
import nodemailer from "nodemailer";

export const transport = nodemailer.createTransport({
  host: "127.0.0.1",
  port: 1025,
  secure: false,
});

await transport.sendMail({
  from: "Acme <hello@acme.test>",
  to: "new-user@example.com",
  subject: "Welcome to Acme",
  text: "Your account is ready.",
  html: "<p>Your account is ready.</p>",
});
```

The message shows up in the web UI right away. You don't need `auth`. Mailpit accepts mail without it, and a test run on 2026-11-08 showed it also accepted a Nodemailer login with any username and password over plain text.

## Send to Mailpit with Email SDK

[Email SDK](/docs) sends through one client to 26 provider APIs and SMTP. In development, give it the SMTP adapter pointed at Mailpit. In production, give it your provider's adapter. The `send` calls stay the same.

```bash
npm install @opencoredev/email-sdk
```

```ts title="email.ts"
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";
import { smtp } from "@opencoredev/email-sdk/smtp";

const apiKey = process.env.RESEND_API_KEY;

export const email = createEmailClient({
  adapters: [
    process.env.NODE_ENV === "production" && apiKey
      ? resend({ apiKey })
      : smtp({ host: "127.0.0.1", port: 1025 }),
  ],
  telemetry: false,
});
```

With no `auth`, the SMTP adapter doesn't require STARTTLS, so it can talk to Mailpit as is. `telemetry: false` turns off the SDK's anonymous usage telemetry, so a local run makes no network calls outside your machine. The SMTP adapter runs on Nodemailer, so the MIME message Mailpit captures is the same one Nodemailer would build.

## Check the captured email in a test

Mailpit's [REST API](https://mailpit.axllent.org/docs/api-v1/) lets a test find the message it just caused. Three endpoints cover most tests:

- `DELETE /api/v1/messages` with no body deletes every message, so each test starts empty.
- `GET /api/v1/search?query=...` takes the same filters as the UI search box, such as `to:new-user@example.com subject:"Welcome"`.
- `GET /api/v1/message/{ID}` returns the parsed message, with `Text`, `HTML`, `Attachments` and headers.

```ts title="welcome.test.ts"
import { beforeEach, expect, test } from "bun:test";
import { createEmailClient } from "@opencoredev/email-sdk";
import { smtp } from "@opencoredev/email-sdk/smtp";

const MAILPIT = "http://127.0.0.1:8025";

type Summary = { ID: string; Subject: string };

async function search(query: string): Promise<Summary[]> {
  const response = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(query)}`);
  if (!response.ok) throw new Error(`Mailpit search failed: ${response.status}`);
  const body = (await response.json()) as { messages: Summary[] };
  return body.messages;
}

const email = createEmailClient({
  adapters: [smtp({ host: "127.0.0.1", port: 1025 })],
  telemetry: false,
});

beforeEach(async () => {
  await fetch(`${MAILPIT}/api/v1/messages`, { method: "DELETE" });
});

test("sign-up sends a welcome email", async () => {
  await email.send({
    from: "Acme <hello@acme.test>",
    to: "new-user@example.com",
    subject: "Welcome to Acme",
    text: "Your account is ready.",
    html: "<p>Your account is ready.</p>",
  });

  const messages = await search('to:new-user@example.com subject:"Welcome to Acme"');
  expect(messages).toHaveLength(1);

  const response = await fetch(`${MAILPIT}/api/v1/message/${messages[0]?.ID}`);
  const message = (await response.json()) as { Text: string; HTML: string };
  expect(message.Text).toContain("Your account is ready.");
  expect(message.HTML).toContain("<p>Your account is ready.</p>");
});
```

SMTP delivery is finished when `send` resolves, so the message is already searchable and the test needs no sleep. In a real app, call the code that sends (your sign-up handler, say) instead of `email.send` directly. Tests that share one Mailpit should run one file at a time, or search on a unique recipient per test, because `DELETE /api/v1/messages` clears every message.

## Test SMTP errors with Mailpit Chaos

A local inbox that always accepts mail never exercises your error handling. Mailpit's Chaos feature makes its SMTP server reply with an error code you choose. Start Mailpit with `--enable-chaos` (`command: --enable-chaos` in Compose), then set triggers through `PUT /api/v1/chaos`. A trigger has an `ErrorCode` from 400 to 599 and a `Probability` from 0 to 100, and can fire on `Sender`, `Recipient` or `Authentication`. Sending `{}` resets them all.

Email SDK's SMTP adapter treats a 4xx reply as temporary and retryable, and a 5xx reply as permanent. Both count as "not sent", because the server refused the message. These two tests prove that against a real SMTP conversation:

```ts title="smtp-errors.test.ts"
import { afterEach, expect, test } from "bun:test";
import { createEmailClient } from "@opencoredev/email-sdk";
import { capturePlugin } from "@opencoredev/email-sdk/plugins/capture";
import { smtp } from "@opencoredev/email-sdk/smtp";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";

const MAILPIT = "http://127.0.0.1:8025";

async function chaos(triggers: object) {
  const response = await fetch(`${MAILPIT}/api/v1/chaos`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(triggers),
  });
  if (!response.ok) throw new Error(`Mailpit chaos failed: ${response.status}`);
}

const message = {
  from: "hello@acme.test",
  to: "user@example.com",
  subject: "Hi",
  text: "Hello.",
};

afterEach(async () => {
  await chaos({});
});

test("a 451 reply is retried", async () => {
  await chaos({ Recipient: { ErrorCode: 451, Probability: 100 } });

  const email = createEmailClient({
    adapters: [smtp({ host: "127.0.0.1", port: 1025 })],
    retry: { maxAttempts: 3, delay: () => 0 },
    plugins: [capturePlugin()],
    telemetry: false,
  });

  await expect(email.send(message)).rejects.toThrow("All configured email adapters failed.");
  expect(email.capture.events.map((event) => event.type)).toEqual([
    "beforeSend",
    "retry",
    "retry",
    "error",
  ]);
});

test("a 550 reply falls back to the next adapter", async () => {
  await chaos({ Recipient: { ErrorCode: 550, Probability: 100 } });

  const backup = memoryAdapter("backup");
  const email = createEmailClient({
    adapters: [smtp({ host: "127.0.0.1", port: 1025 }), backup],
    fallback: { adapters: ["backup"] },
    telemetry: false,
  });

  const result = await email.send(message);
  expect(result.adapter).toBe("backup");
  expect(backup.raw?.sent).toHaveLength(1);
});
```

`maxAttempts` counts every call, so 3 means one send and two retries. The client doesn't retry unless you set `retry`. Fallback after a 550 is safe because the server refused the message. A timeout after the message data went out is different. The SDK marks that delivery "unknown" and, by default, stops instead of trying the next adapter, because the first server may have accepted it. [Retries and provider fallback](/docs/concepts/fallbacks-and-retries) covers that rule and the `onUnknownDelivery` option.

## Mailpit, Ethereal, a memory adapter or a provider sandbox?

| Tool | What it proves | Runs where |
| --- | --- | --- |
| [`memoryAdapter()`](/docs/guides/test-email-behavior) | Your code sends the right message object | In the test process, no network |
| Mailpit or MailHog | The MIME message, headers, attachments and HTML render as a mail client sees them | Local container or binary |
| [Ethereal](https://ethereal.email) | Same, in a throwaway hosted inbox (`nodemailer.createTestAccount()`) | Ethereal's servers |
| Provider sandbox (SendGrid sandbox mode, Mailgun `o:testmode`) | The provider accepts your request and API key | The provider's API |

Most apps want two of these. Unit tests use the memory adapter because it's fast and needs nothing running. Integration tests and local development use Mailpit to look at the real message. A provider sandbox only checks the provider's side, and some providers bill test-mode messages (Mailgun does, see the [Mailgun API guide](/blog/mailgun-api-nodejs-typescript)). None of these prove inbox placement. That still needs a real send from your own account.

## Questions

### Is MailHog still maintained?

No. Its last release is v1.0.1 from August 2020. Mailpit is the usual replacement and uses the same ports, 1025 for SMTP and 8025 for the web UI.

### Does Mailpit work with Nodemailer?

Yes. Create a transport with `host: "127.0.0.1"`, `port: 1025` and `secure: false`, and leave `auth` out. Email SDK's `smtp()` adapter does the same thing with `smtp({ host: "127.0.0.1", port: 1025 })`.

### How do I read the email in a test?

Search with `GET /api/v1/search?query=to:user@example.com`, then fetch `GET /api/v1/message/{ID}` for the text, HTML and attachments. Clear the inbox between tests with `DELETE /api/v1/messages`.

### Can Mailpit simulate a bounce or SMTP error?

Start it with `--enable-chaos` and set a trigger, for example `{"Recipient": {"ErrorCode": 550, "Probability": 100}}`, with `PUT /api/v1/chaos`. The next send gets that reply during the SMTP conversation. It doesn't simulate a bounce that arrives later, after the server accepted the message.

## Related

- [Test email sending without sending real email](/docs/guides/test-email-behavior): the memory adapter, failing adapters and the capture plugin.
- [How to send email from Node.js and TypeScript](/blog/send-email-nodejs-typescript): SMTP, HTTP APIs and one client for any provider.
- [SMTP adapter reference](/docs/adapters/smtp): host, port, TLS and authentication options.
- [Migrate from Nodemailer](/docs/guides/migrate/nodemailer): keep SMTP and add provider APIs and fallback.
