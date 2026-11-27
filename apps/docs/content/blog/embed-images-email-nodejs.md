---
title: "Embed Images in Email from Node.js: CID Inline Attachments"
description: "Embed images in Node.js email with CID inline attachments: Nodemailer's cid field and example Resend, SendGrid, Postmark and Mailgun payloads."
type: blog
date: 2026-11-27
lastModified: 2026-11-27
search:
  tags: ["Attachments", "HTML email", "Node.js"]
---

To embed an image in an email from Node.js, attach the image with a Content-ID and point an `<img>` tag at it with `src="cid:<that id>"`. The image travels inside the message, so a client that supports CID images can show it in the body without fetching anything from a server.

This guide covers the three ways to put an image in an HTML email, the CID method with Nodemailer, and the same message sent through the Resend, SendGrid, Postmark and Mailgun APIs with [Email SDK](/docs). The provider payloads below were checked on 2026-11-27 against `@opencoredev/email-sdk` 3.1.0 with a stubbed `fetch`, so no real email was sent.

## Which way should you add images to an email?

Link to a hosted image for most newsletter email, and use a CID inline attachment for small images that must travel with the message, such as a logo on a receipt or a QR code. Avoid base64 `data:` URIs: [Gmail doesn't display them](https://www.caniemail.com/features/image-base64/).

| Method | How it works | Good for | Watch out for |
| --- | --- | --- | --- |
| Hosted image | `<img src="https://...">` | Newsletters, large images | Many clients hide remote images until the reader allows them |
| CID inline attachment | Image attached with a Content-ID, `<img src="cid:logo.png">` | Logos, receipts, QR codes, signatures | Every image adds to the message size, and some clients also list it as an attachment |
| Base64 `data:` URI | Image bytes inside the `src` attribute | Nothing in email | Not displayed in Gmail |

A CID image is a MIME part of the message, usually inside a `multipart/related` section next to the HTML, with a `Content-ID` header and `Content-Disposition: inline`. The client matches `cid:logo.png` in the HTML to the part whose Content-ID is `logo.png`. Base64 encoding adds about a third to each image's size in transit, so keep inline images small: a logo or a QR code, not a photo gallery.

## Embed an image with Nodemailer

Nodemailer takes the Content-ID in a `cid` field on the attachment. Install it and put a real PNG at `./emails/logo.png`:

```bash
npm install nodemailer
```

```ts title="send.ts"
import nodemailer from "nodemailer";

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: 587,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

await transport.sendMail({
  from: "Acme <hello@acme.test>",
  to: "ada@example.com",
  subject: "Your receipt",
  html: '<img src="cid:logo.png" alt="Acme" width="120" height="40"><p>Thanks for your order.</p>',
  text: "Thanks for your order.",
  attachments: [{ filename: "logo.png", path: "./emails/logo.png", cid: "logo.png" }],
});
```

Replace the sender and recipient with an address your SMTP server lets you send from and an inbox you can read. Nodemailer builds the `multipart/related` part for you, and the [Nodemailer embedded images docs](https://nodemailer.com/message/embedded-images) cover the `cid` option in full. To send the same image through a provider's HTTP API instead, use that provider's field for the Content-ID.

## Embed images through an email API

The major email APIs accept inline images, but each names the Content-ID field differently:

| Provider | Field for the Content-ID | Inline marker |
| --- | --- | --- |
| [Resend](https://resend.com/docs/dashboard/emails/embed-inline-images) | `content_id` on the attachment | the `content_id` itself |
| [SendGrid](https://github.com/twilio/sendgrid-oai/blob/main/spec/yaml/tsg_mail_v3.yaml) | `content_id` | `disposition: "inline"` |
| [Postmark](https://postmarkapp.com/developer/api/email-api) | `ContentID`, written as `"cid:logo.png"` in Postmark's docs | the `ContentID` itself |
| [Mailgun](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages) | none; the file name is the CID | an `inline` form part instead of `attachment` |
| [Amazon SES (v2 API)](https://docs.aws.amazon.com/ses/latest/APIReference-V2/API_Attachment.html) | `ContentId` | `ContentDisposition: "INLINE"` |

Two of these catch people out. Mailgun has no Content-ID field: you send the image as a form part named `inline`, and its file name, `logo.png`, is what the HTML references as `cid:logo.png`. Resend [doesn't accept attachments, inline images included, on its batch endpoint](https://resend.com/docs/dashboard/emails/embed-inline-images), so a receipt with a CID-embedded logo has to go through the single-send endpoint.

## Send an inline image with Email SDK

[Email SDK](/docs/reference/message) gives every attachment a `contentId` and a `disposition`, and adapters that support inline images turn them into their provider's fields. Set `contentId` to the same value as `filename` so the `cid:` reference also works on Mailgun.

```bash
npm install @opencoredev/email-sdk
```

```ts title="receipt.ts"
import { readFile } from "node:fs/promises";
import { createEmailClient } from "@opencoredev/email-sdk";
import { resend } from "@opencoredev/email-sdk/resend";

const email = createEmailClient({
  adapters: [resend({ apiKey: process.env.RESEND_API_KEY! })],
});

const logo = await readFile("./emails/logo.png");

await email.send({
  from: "Acme <hello@acme.test>",
  to: "ada@example.com",
  subject: "Your receipt",
  html: '<img src="cid:logo.png" alt="Acme" width="120" height="40"><p>Thanks for your order.</p>',
  text: "Thanks for your order.",
  attachments: [
    {
      filename: "logo.png",
      content: logo,
      contentType: "image/png",
      contentId: "logo.png",
      disposition: "inline",
    },
  ],
});
```

Use a sender on a domain you verified in Resend and a recipient you can read. With the SendGrid or Mailgun adapter in place of `resend`, the message stays the same. This is what each adapter sent for the attachment in our stubbed check (image bytes shortened):

```json title="Resend: attachments"
[{ "filename": "logo.png", "content": "<base64>", "content_type": "image/png", "content_id": "logo.png" }]
```

```json title="SendGrid: attachments"
[{ "filename": "logo.png", "content": "<base64>", "type": "image/png", "content_id": "logo.png", "disposition": "inline" }]
```

```json title="Postmark: Attachments"
[{ "Name": "logo.png", "Content": "<base64>", "ContentType": "image/png", "ContentID": "cid:logo.png" }]
```

The Postmark block was sent with `contentId: "cid:logo.png"`. The SDK passes `contentId` to Postmark unchanged, and Postmark's docs write the `ContentID` with a `cid:` prefix, so when Postmark is the adapter, use that value and keep `src="cid:logo.png"` in the HTML.

Mailgun got a multipart form with the image as a part named `inline` and file name `logo.png`. The SMTP adapter passes `contentId` to Nodemailer as `cid`, and the SES, Microsoft Graph, MailerSend, Mailtrap, Lettermint and Cloudflare adapters map it to their own fields as well.

Not every adapter supports inline images. Lettr and SendHeron throw an `EmailValidationError` before any request when an attachment has a `contentId` or `disposition: "inline"`, and the Loops adapter sends the image as a regular attachment without a Content-ID. Check your adapter's page in the [adapter docs](/docs/adapters) before relying on CID images, and host the image at a public URL where they aren't supported.

## Test that the image is embedded

Send the message to a local SMTP inbox such as Mailpit, then check the message source, not only how it looks. The decoded HTML part should contain `src="cid:logo.png"` (in the raw source, quoted-printable encoding shows it as `src=3D"cid:logo.png"`) and the image part should carry `Content-ID: <logo.png>` and `Content-Disposition: inline`. Seeing the image in Mailpit's viewer isn't proof on its own, because Mailpit also loads remote images. With the defaults from the [Mailpit guide](/blog/mailpit-mailhog-nodejs), point Nodemailer or Email SDK's SMTP adapter at `127.0.0.1` port `1025` with no auth.

If the image shows up only as an attachment, one common cause is a `cid:` value in the HTML that doesn't match the attachment's Content-ID: a typo, a missing `cid:` prefix in the `src`, or, on Mailgun, a file name that differs from the reference. Clients also differ in how they show inline parts, so send a test to the clients your users actually read mail in.

For unit tests that shouldn't touch SMTP at all, the [memory adapter](/docs/guides/test-email-behavior) records each message, attachments included, so you can assert on `contentId` directly.

## FAQ

### What does cid mean in email?

CID stands for Content-ID, a MIME header that names one part of an email. `src="cid:logo.png"` in the HTML tells the client to render the part whose Content-ID is `logo.png` in that spot.

### Why does my embedded image show up as an attachment?

Usually the client couldn't match the `cid:` reference to an inline part. Check that the value after `cid:` in the `src` equals the attachment's Content-ID exactly and that the part is sent as inline: on SendGrid that needs `disposition: "inline"`, on Mailgun the `inline` form part and a reference by file name. Some clients list inline images as attachments even when the match is right.

### Can I embed an SVG in an email?

Support for SVG varies by email client and by how the SVG is included, so use PNG or JPEG for logos and icons unless you have tested SVG in the clients you send to.

### Do inline images count against attachment size limits?

Yes. An inline image is an attachment with a different disposition, so it counts toward the provider's message size limit after base64 encoding.

## Related

- [How to send email from Node.js and TypeScript](/blog/send-email-nodejs-typescript): SMTP, HTTP APIs and one client for any provider.
- [MailHog and Mailpit](/blog/mailpit-mailhog-nodejs): a local SMTP inbox for checking embedded images.
- [Message reference](/docs/reference/message): every attachment field, `contentId` and `disposition` included.
- [SMTP adapter reference](/docs/adapters/smtp): host, port, TLS and authentication options.
