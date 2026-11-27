---
title: "Embed Images in Email from Node.js: CID Inline Attachments"
description: "Embed images in email from Node.js with CID inline attachments: the cid: reference, Nodemailer's cid field, and the same image through the Resend, SendGrid, Postmark and Mailgun APIs."
type: blog
date: 2026-11-27
lastModified: 2026-11-27
search:
  tags: ["Attachments", "HTML email", "Node.js"]
---

To embed an image in an email from Node.js, attach the image with a Content-ID and point an `<img>` tag at it with `src="cid:<that id>"`. The image travels inside the message, so the email client shows it in the body instead of as a download, and nothing has to be hosted.

This guide shows the three ways to put an image in an HTML email, the CID method with Nodemailer, and the same message sent through the Resend, SendGrid, Postmark and Mailgun APIs with [Email SDK](/docs). The provider payloads below were checked on 2026-11-27 against `@opencoredev/email-sdk` 3.1.0 with a stubbed `fetch`, so no real email was sent.

## Which way should you add images to an email?

Link to a hosted image for most marketing and newsletter email, and use a CID inline attachment when the image must show up without the reader clicking "load images" or when you can't host files. Avoid base64 `data:` URIs: some clients, Gmail among them, don't display them.

| Method | How it works | Good for | Watch out for |
| --- | --- | --- | --- |
| Hosted image | `<img src="https://...">` | Newsletters, large images | Many clients hide remote images until the reader allows them |
| CID inline attachment | Image attached with a Content-ID, `<img src="cid:logo">` | Logos, receipts, QR codes, signatures | Every image adds to the message size |
| Base64 `data:` URI | Image bytes inside the `src` attribute | Nothing in email | Not displayed by some clients, Gmail among them |

A CID image is a MIME part of the message, usually inside a `multipart/related` section next to the HTML, with a `Content-ID` header and `Content-Disposition: inline`. The client matches `cid:logo` in the HTML to the part whose Content-ID is `logo`. Base64 adds about a third to each image's size in transit, so keep inline images small: a logo or a QR code, not a photo gallery.

## Embed an image with Nodemailer

Nodemailer takes the Content-ID in a `cid` field on the attachment:

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

Nodemailer builds the `multipart/related` part for you. The [Nodemailer embedded images docs](https://nodemailer.com/message/embedded-images) cover the `cid` option in full. This works for any SMTP server. To send the same image through a provider's HTTP API instead, each provider has its own field for the Content-ID.

## Embed images through an email API

Every major email API accepts inline images, but each names the Content-ID field differently:

| Provider | Field for the Content-ID | Inline marker |
| --- | --- | --- |
| [Resend](https://resend.com/docs/dashboard/emails/embed-inline-images) | `content_id` on the attachment | the `content_id` itself |
| SendGrid | `content_id` | `disposition: "inline"` |
| [Postmark](https://postmarkapp.com/developer/user-guide/send-email-with-api/send-a-single-email) | `ContentID` | the `ContentID` itself |
| [Mailgun](https://documentation.mailgun.com/docs/mailgun/api-reference/send/mailgun/messages/post-v3--domain-name--messages) | none; the file name is the CID | an `inline` form part instead of `attachment` |
| Amazon SES (v2 API) | `ContentId` | `ContentDisposition: "INLINE"` |

Two of these catch people out. Mailgun has no Content-ID field: you send the image as an `inline` part and reference it by its file name, `cid:logo.png`. Resend [doesn't accept attachments, inline images included, on its batch endpoint](https://resend.com/docs/dashboard/emails/embed-inline-images), so a receipt with a logo has to go through the single-send endpoint.

## Send one inline image to any provider with Email SDK

[Email SDK](/docs/reference/message) gives every attachment a `contentId` and a `disposition`, and each adapter turns them into its provider's fields. Set `contentId` to the same value as `filename` and the `cid:` reference in your HTML works on Mailgun too.

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

Swap `resend` for another adapter and the message stays the same. This is what each adapter sent for the attachment above in our check (image bytes shortened):

```json title="Resend: attachments"
[{ "filename": "logo.png", "content": "<base64>", "content_type": "image/png", "content_id": "logo.png" }]
```

```json title="SendGrid: attachments"
[{ "filename": "logo.png", "content": "<base64>", "type": "image/png", "content_id": "logo.png", "disposition": "inline" }]
```

```json title="Postmark: Attachments"
[{ "Name": "logo.png", "Content": "<base64>", "ContentType": "image/png", "ContentID": "logo.png" }]
```

Mailgun got a multipart form with the image as an `inline` part named `logo.png`. The SMTP adapter passes `contentId` to Nodemailer as `cid`, and the SES, Microsoft Graph, MailerSend, Mailtrap, Lettermint and Cloudflare adapters map it to their own fields too. The [field support table](/docs/adapters/field-support) shows which message fields each adapter supports.

Two adapters refuse inline images: Lettr and SendHeron throw an `EmailValidationError` before any request when an attachment has a `contentId` or `disposition: "inline"`, so the image is never dropped without you knowing. Host the image at a public URL for those.

## Test that the image is embedded

Send the message to a local SMTP inbox such as Mailpit and open it there. An image that shows in the body with no "load images" prompt is embedded. If it shows up as a separate attachment, the `cid:` value in the HTML and the attachment's Content-ID don't match, often because of a typo, a missing `cid:` prefix in the `src`, or, on Mailgun, a file name that differs from the reference. The [Mailpit guide](/blog/mailpit-mailhog-nodejs) sets up the local inbox and checks messages through its API in a test.

For unit tests that shouldn't touch SMTP at all, the [memory adapter](/docs/guides/test-email-behavior) records each message, attachments included, so you can assert on `contentId` directly.

## FAQ

### What does cid mean in email?

CID stands for Content-ID, a MIME header that names one part of an email. `src="cid:logo.png"` in the HTML tells the client to render the part whose Content-ID is `logo.png` in that spot.

### Why does my embedded image show up as an attachment?

The client couldn't match the `cid:` reference to an inline part. Check that the `src` value after `cid:` equals the attachment's Content-ID exactly, and that the part is sent as inline. On SendGrid that needs `disposition: "inline"`; on Mailgun it needs the `inline` form part and a reference by file name.

### Can I embed an SVG in an email?

You can attach one, but support for SVG in email clients is poor, so use PNG or JPEG for logos and icons in email.

### Do inline images count against attachment size limits?

Yes. An inline image is an attachment with a different disposition, so it counts toward the provider's message size limit, after base64 encoding.

## Related

- [How to send email from Node.js and TypeScript](/blog/send-email-nodejs-typescript): SMTP, HTTP APIs and one client for any provider.
- [MailHog and Mailpit](/blog/mailpit-mailhog-nodejs): a local SMTP inbox for checking embedded images.
- [Message reference](/docs/reference/message): every attachment field, `contentId` and `disposition` included.
- [SMTP adapter reference](/docs/adapters/smtp): host, port, TLS and authentication options.
