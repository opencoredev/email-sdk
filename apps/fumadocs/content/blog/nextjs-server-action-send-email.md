# Send Email from a Next.js Server Action in TypeScript

To send transactional email from a Next.js server action, write an async function in a `"use server"` file that reads the form's `FormData`, validates it, and calls your email provider from the server. The API key stays in a server-only environment variable and never reaches the browser. A client component passes the action to React's `useActionState` to show a pending state and the result.

This guide builds a contact form that way with the App Router, then covers what a bare example skips: duplicate submissions, retries, keeping the visitor's text when a send fails, a fallback provider, and tests that send nothing. The contact form below was built and run on 2026-11-09 with Next.js 16.4.5, React 19, zod 4.6 and `@opencoredev/email-sdk` 3.0.1, and the fallback client was type-checked against the same versions. A local stub stood in for Resend's API, so no real email was sent.

## What you need

- A Next.js app using the App Router. Server actions run in the Node.js runtime by default, which is what Email SDK needs (Node.js 20+ or Bun 1.1+, server-side only).
- An account with a transactional email provider and a verified sending domain. This guide uses [Resend](/blog/resend-api-nodejs-typescript), and any of Email SDK's 26 provider adapters or SMTP works the same way. The [email DNS checker](/tools/email-dns-checker) shows whether your domain's SPF, DKIM and DMARC records resolve.

```bash
npm install @opencoredev/email-sdk zod server-only
```

Put the key in `.env.local` without a `NEXT_PUBLIC_` prefix. Next.js copies `NEXT_PUBLIC_` variables into the browser bundle, and anyone holding a sending key can send mail as your domain.

```bash title=".env.local"
RESEND_API_KEY=re_...
```

## Create the email client

`lib/email.ts`:

```ts
import "server-only";

import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";

const apiKey = process.env.RESEND_API_KEY;

if (!apiKey) throw new Error("Set RESEND_API_KEY.");

export const email = createEmailClient({
  adapters: [resend({ apiKey })],
  retry: { maxAttempts: 3 },
});
```

`import "server-only"` makes the build fail if a client component ever imports this file. Without `retry`, the client makes one attempt. With `maxAttempts: 3` it retries rate limits (`429`), `5xx` responses and transient network errors, and that's safe here because the action below passes an idempotency key that goes out with every attempt.

## Validate the form and build the message

Server actions are reachable by direct POST requests, not only through your form ([Next.js: Mutating data](https://nextjs.org/docs/app/getting-started/mutating-data), checked Nov 2026). Treat the `FormData` as untrusted input and parse it before it goes anywhere near an email.

`lib/contact.ts`:

```ts
import { createHash } from "node:crypto";

import type { EmailMessage } from "@opencoredev/email-sdk";
import { z } from "zod";

const contactSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Enter your name.")
    .max(100)
    .regex(/^[^\r\n]*$/, "Use one line for your name."),
  email: z.email("Enter a valid email address."),
  message: z.string().trim().min(10, "Write at least 10 characters.").max(5000),
});

export type ContactEmail =
  | { ok: true; message: EmailMessage; idempotencyKey: string }
  | { ok: false; error: string };

export function buildContactEmail(formData: FormData): ContactEmail {
  const parsed = contactSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    message: formData.get("message"),
  });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form." };
  }

  const { name, email, message } = parsed.data;
  const digest = createHash("sha256").update(JSON.stringify([name, email, message])).digest("hex");

  return {
    ok: true,
    idempotencyKey: `contact-form/${digest}`,
    message: {
      from: "Acme Contact Form <contact@acme.com>",
      to: "support@acme.com",
      replyTo: email,
      subject: "New contact form message",
      text: `From: ${name} <${email}>\n\n${message}`,
    },
  };
}
```

Three choices in this file matter more than they look:

- The visitor's address goes in `replyTo`, not `from`. Providers only send from domains you've verified, and hitting Reply in your inbox still answers the visitor.
- The recipient is fixed in code. A form field that sets `to` turns your action into an open relay for anyone who finds the POST endpoint.
- The idempotency key is a hash of the name, address and message. A double click, or a second submit after a timeout, produces the same key, and Resend won't send a second email for a repeated key and body within 24 hours ([Resend idempotency keys](https://resend.com/docs/dashboard/emails/idempotency-keys), checked Nov 2026). Someone who sends the exact same message twice in a day gets one email, which is fine for a contact form.

Keeping this logic out of the `"use server"` file also makes it testable. The `server-only` package throws when it's imported outside a React Server Components build, so a test can't import `lib/email.ts`, but it can import `lib/contact.ts`.

## Write the server action

`app/contact/actions.ts`:

```ts
"use server";

import { EmailValidationError } from "@opencoredev/email-sdk";

import { buildContactEmail } from "@/lib/contact";
import { email } from "@/lib/email";

export type ContactState = {
  status: "idle" | "sent" | "error";
  message: string;
  fields?: { name: string; email: string; message: string };
};

export async function sendContactMessage(
  _previous: ContactState,
  formData: FormData,
): Promise<ContactState> {
  const fields = {
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    message: String(formData.get("message") ?? ""),
  };
  const built = buildContactEmail(formData);

  if (!built.ok) return { status: "error", message: built.error, fields };

  try {
    await email.send(built.message, { idempotencyKey: built.idempotencyKey });
  } catch (error) {
    console.error("Contact form email failed", error);

    return {
      status: "error",
      fields,
      message:
        error instanceof EmailValidationError
          ? "We couldn't send that message. Check the form and try again."
          : "Sending failed. Try again in a minute.",
    };
  }

  return { status: "sent", message: "Thanks, we'll reply by email." };
}
```

The action logs the real error on the server and returns a plain message to the browser. Whatever a server action returns is serialized and sent to the client, so don't return the error object: provider errors can include response bodies you didn't mean to show.

An `EmailValidationError` means the message itself was rejected before any request went out, for example a field the provider can't carry. An `EmailRouteError` means every adapter attempt failed. Its `failures` list holds each attempt's error, and an error the SDK doesn't retry, such as a `401` for a bad key, fails after one attempt.

## Build the form

`app/contact/contact-form.tsx`:

```tsx
"use client";

import { useActionState } from "react";

import { type ContactState, sendContactMessage } from "./actions";

const initialState: ContactState = { status: "idle", message: "" };

export function ContactForm() {
  const [state, formAction, pending] = useActionState(sendContactMessage, initialState);

  return (
    <form action={formAction}>
      <label>
        Name <input name="name" required maxLength={100} defaultValue={state.fields?.name} />
      </label>
      <label>
        Email{" "}
        <input name="email" type="email" required defaultValue={state.fields?.email} />
      </label>
      <label>
        Message{" "}
        <textarea
          name="message"
          required
          minLength={10}
          maxLength={5000}
          defaultValue={state.fields?.message}
        />
      </label>
      <button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send"}
      </button>
      <p aria-live="polite">{state.message}</p>
    </form>
  );
}
```

`app/contact/page.tsx`:

```tsx
import { ContactForm } from "./contact-form";

export default function ContactPage() {
  return (
    <main>
      <h1>Contact us</h1>
      <ContactForm />
    </main>
  );
}
```

React 19 resets a form's fields once its action returns, and an action that returns an error state still counts as finished. Without the `defaultValue` props, a failed send clears the visitor's message. With them, the form refills from `state.fields` after an error, and a successful send, which returns no `fields`, leaves it empty. `pending` disables the button while the action runs, which stops most double clicks before they reach the server.

The page itself is static: `next build` prerenders `/contact`, and the email code runs only when someone submits.

## What happened when we ran it

With the app built by `next build` and served by `next start`, and Resend's API replaced by a local stub:

| Case | Result |
| --- | --- |
| Valid submit | One request to `/emails`, `reply_to` set to the visitor |
| Same text sent again | Same `Idempotency-Key` header as before |
| Provider returns `500` | Three attempts, all with one key, then "Sending failed" |
| Message too short | zod error shown, no request made |

After the `500`, the textarea still held the visitor's text.

## Add a fallback provider

To fail over to a second provider, list both adapters and name the fallback:

`lib/email.ts`:

```ts
import "server-only";

import { createEmailClient } from "@opencoredev/email-sdk";
import { postmark } from "@opencoredev/email-sdk/postmark";
import { resend } from "@opencoredev/email-sdk/resend";

export const email = createEmailClient({
  adapters: [
    resend({ apiKey: process.env.RESEND_API_KEY! }),
    postmark({ serverToken: process.env.POSTMARK_SERVER_TOKEN! }),
  ],
  defaultAdapter: "resend",
  retry: { maxAttempts: 3 },
  fallback: { adapters: ["postmark"], onUnknownDelivery: "continue" },
});
```

Read the last line carefully. The Resend adapter reports every failed request, HTTP error or network error, as delivery `"unknown"`, because a timeout can't prove Resend didn't accept the message. With the default, `onUnknownDelivery: "stop"`, the client throws after the Resend attempts and never calls Postmark. `"continue"`, as above, sends through Postmark anyway, so the recipient can get two copies when Resend did accept the first one. The idempotency key doesn't help across providers: Postmark has no idempotency key, and it never sees Resend's. For a contact form, a rare duplicate is better than a lost message. For receipts or password resets, decide per message. [Retries and provider fallback](/docs/concepts/fallbacks-and-retries) covers both settings.

## Test it without sending email

Email SDK's `memoryAdapter` records messages instead of sending them. Test the message builder with a client built on it:

`lib/contact.test.ts`:

```ts
import { expect, test } from "bun:test";

import { createEmailClient } from "@opencoredev/email-sdk";
import { memoryAdapter } from "@opencoredev/email-sdk/testing";

import { buildContactEmail } from "./contact";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

test("sends a valid contact message with the visitor as reply-to", async () => {
  const memory = memoryAdapter();
  const email = createEmailClient({ adapters: [memory], telemetry: false });

  const built = buildContactEmail(
    form({ name: "Ada", email: "ada@example.com", message: "I'd like a demo, please." }),
  );
  if (!built.ok) throw new Error(built.error);

  await email.send(built.message, { idempotencyKey: built.idempotencyKey });

  expect(memory.raw?.sent).toHaveLength(1);
  expect(memory.raw?.sent[0]?.message.replyTo).toBe("ada@example.com");
});

test("rejects a bad address before anything is sent", () => {
  const built = buildContactEmail(
    form({ name: "Ada", email: "not-an-email", message: "I'd like a demo, please." }),
  );

  expect(built).toEqual({ ok: false, error: "Enter a valid email address." });
});

test("gives the same submission the same idempotency key", () => {
  const fields = { name: "Ada", email: "ada@example.com", message: "I'd like a demo, please." };
  const first = buildContactEmail(form(fields));
  const second = buildContactEmail(form(fields));

  expect(first.ok && second.ok && first.idempotencyKey === second.idempotencyKey).toBe(true);
});
```

`telemetry: false` turns off Email SDK's anonymous usage telemetry for that client. In CI you can set `EMAIL_SDK_TELEMETRY=0` instead ([Telemetry](/docs/reference/telemetry)). The same tests run under Vitest or Jest with their own `expect` import. To look at the rendered message through real SMTP, point the [SMTP adapter](/docs/adapters/smtp) at a local inbox; the [Mailpit and MailHog guide](/blog/mailpit-mailhog-nodejs) walks through it.

## Before you ship it

- Rate-limit the action, for example per IP address. Every POST costs a provider send, and bots find contact forms quickly.
- Check authentication inside the action if the form is behind a login. Hiding the form doesn't protect the endpoint.
- Keep user input out of `from`, `to` and custom headers.
- Store the provider's message ID (`result.id` from `email.send`) if you need to match bounce webhooks to a submission.
- Send a plain text body. This form sends only text; add `html` if you want a styled email.

## Questions

### Should I use a server action or a route handler?

Use a server action for forms in your own app: it needs no API route, works with `useActionState`, and Next.js gives each action a non-guessable ID. Use a route handler (`app/api/.../route.ts`) when something outside your React code calls it, such as a webhook, a mobile app or a cron job. The email code is the same in both.

### Can I send email from Next.js middleware or the Edge runtime?

Keep sending in the Node.js runtime, the default for server actions and route handlers. Email SDK supports Node.js 20+ and Bun 1.1+, server-side only.

### Why not call the provider's API with fetch directly?

You can. The [Resend API guide](/blog/resend-api-nodejs-typescript) shows the raw request. Email SDK adds one message shape across providers, retries that reuse the idempotency key, a fallback list, and a memory adapter for tests, and switching providers means changing `lib/email.ts` only.

### How do I send a React email template?

Render it to an HTML string in the server action with `render()` from `@react-email/render`, then pass it as `html` along with a plain-text `text` version (`toPlainText()` from the same package makes one). Don't import Email SDK's `@opencoredev/email-sdk/react` entry point from a server action: it includes client-side React components that use context, which a server action's build can't load.

## Related

- [How to send email from Node.js and TypeScript](/blog/send-email-nodejs-typescript): SMTP, provider HTTP APIs, and one client for any provider.
- [Resend API guide for Node.js and TypeScript](/blog/resend-api-nodejs-typescript): keys, idempotency, errors and webhooks with plain `fetch`.
- [Quickstart](/docs/getting-started/quickstart): install Email SDK and send a first email.
- [Test email sending without sending real email](/docs/guides/test-email-behavior): memory adapter, failure cases and local SMTP.
