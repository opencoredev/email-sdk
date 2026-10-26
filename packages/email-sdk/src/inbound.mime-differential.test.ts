/**
 * Differential test: every message in the corpus goes through the SDK's MIME parser and through
 * postal-mime (a dev-only reference parser), and the normalized results must agree. A field may
 * differ only when `allowed` lists it with the reason the SDK is right or deliberately different.
 */
import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import PostalMime from "postal-mime";
import type { Address, Email } from "postal-mime";
import { emailFromMime } from "./inbound/normalize.js";
import type { InboundAddress, InboundEmail } from "./inbound/types.js";

const fixture = (name: string) => readFileSync(new URL(`./__fixtures__/inbound/${name}`, import.meta.url));

const fixtureJson = (name: string) => JSON.parse(fixture(name).toString("utf8"));

/** One char per byte, as raw mail arrives. */
const bytes = (message: string) => Uint8Array.from(message, char => char.charCodeAt(0));

const utf8 = (message: string) => new TextEncoder().encode(message);

const crlf = (...lines: string[]) => lines.join("\r\n");

const part = (type: string, body: string, headers: string[] = []) => crlf(`Content-Type: ${type}`, ...headers, "", body);

const multi = (type: string, boundary: string, parts: string[], extra = "") => part(
  `${type}; boundary="${boundary}"${extra}`,
  `${parts.map(child => `--${boundary}\r\n${child}\r\n`).join("")}--${boundary}--\r\n`,
);

/** Top-level headers followed by an entity, which brings its own content headers and blank line. */
const message = (headers: string[], entity: string) => crlf(...headers, entity);

/** An entity with no content headers: just the blank line and the body. */
const plain = (body: string) => crlf("", body);

const envelope = ["From: Ada <ada@example.com>", "To: Bob <bob@example.com>", "Subject: corpus", "Message-ID: <corpus@example.com>", "MIME-Version: 1.0"];

const forwarded = crlf("From: inner@example.com", "Subject: inner", "", "inner body", "");

const pdfBase64 = fixture("attachment.pdf.bin").toString("base64").replace(/.{76}/g, "$&\r\n");

const pngBase64 = fixture("logo.png.bin").toString("base64");

const iso2022jp = Buffer.from([0x1b, 0x24, 0x42, 0x24, 0x33, 0x24, 0x73, 0x24, 0x4b, 0x24, 0x41, 0x24, 0x4f, 0x1b, 0x28, 0x42]);

const corpus: [name: string, raw: Uint8Array][] = [
  // Every fixture that carries a raw MIME message.
  ["fixture: multipart.eml", new Uint8Array(fixture("multipart.eml"))],
  ["fixture: mailersend data.raw", utf8(fixtureJson("mailersend-inbound.json").data.raw)],
  ["fixture: mailpace raw", utf8(fixtureJson("mailpace-inbound.json").raw)],
  ["fixture: sparkpost email_rfc822", new Uint8Array(Buffer.from(fixtureJson("sparkpost-relay.json")[0].msys.relay_message.content.email_rfc822, "base64"))],
  ["fixture: primitive raw.data", new Uint8Array(Buffer.from(fixtureJson("primitive-email-received.json").email.content.raw.data, "base64"))],

  // Inputs from the round-2 review reports.
  ["review: interleaved parameter comments", bytes(`Content-Type: text/plain;${" ".repeat(200)}name=x${"(a)x".repeat(200)}\r\n\r\nhi`)],
  ["review: comment inside media type", bytes("Content-Type: text(comment)/plain\r\n\r\nhello")],
  ["review: comment before boundary =", bytes("Content-Type: multipart/mixed; boundary(comment)=b\r\n\r\n--b\r\n\r\nhello\r\n--b--")],
  ["review: CFWS before domain literal", bytes("From: user@ [IPv6:2001:db8::1]\r\nTo: user@ [IPv6:2001:db8::1], next@example.com\r\n\r\nhi")],
  ["review: CFWS before literal with >", bytes("From: Ops <ops@ [a>b]>\r\nTo: next@example.com\r\n\r\nhi")],
  ["review: Shift_JIS mixed RFC 2231", bytes("Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename*0*=Shift_JIS''%83; filename*1=\"e.txt\"\r\n\r\nx")],
  ["review: ISO-2022-JP mixed RFC 2231", bytes("Content-Type: application/octet-stream\r\nContent-Disposition: attachment; filename*0*=iso-2022-jp''%1B%24%42; filename*1=\"$3$s$K$A$O\"; filename*2*=%1B%28%42.txt\r\n\r\nx")],
  ["review: comments around threading IDs", bytes("Message-ID: (see <wrong@example.com>) <right@example.com>\r\nIn-Reply-To: (see <fake@example.com>) <parent@example.com>\r\nReferences: (see <fake@example.com>) <parent@example.com>\r\n\r\nhi")],
  ["review: parentheses in a domain literal", bytes("From: user@[a(b)c]\r\nTo: user@[a(b)c], next@example.com\r\n\r\nhi")],
  ["review: two quoted display-name words", bytes("From: \"John\" \"Doe\" <john@example.com>\r\n\r\nhi")],
  ["review: obsolete source route", bytes("From: <@route1.example,@route2.example:user@example.com>\r\n\r\nhi")],
  ["review: source route with literal relays", bytes("From: <@[127.0.0.1]:user@example.com>\r\nTo: <@a.example,@[IPv6:2001:db8::1]:user@example.com>, Ops <@[a]:ops@example.com>\r\n\r\nhi")],
  ["review: byte order mark in each encoded word", bytes("Subject: =?UTF-16LE?B?//5BAA==?= =?UTF-16LE?B?//5CAA==?= =?UTF-16BE?B?/v8AQw==?= =?UTF-8?B?77u/RA==?=\r\n\r\nhi")],
  ["review: byte order picks unmarked UTF-16", bytes("Subject: =?UTF-16?B?/v8AQQ==?= =?UTF-16?B?//5CAA==?=\r\n\r\nhi")],
  ["review: > in a message-ID domain literal", bytes("Message-ID: <thread@[a>b]>\r\nIn-Reply-To: <parent@[a>b]>\r\nReferences: <x@[a>b]> <y@example.com>\r\n\r\nhi")],
  ["review: parentheses in a bare message-ID literal", bytes("Message-ID: thread@[a(b)c]\r\n\r\nhi")],
  ["review: > in a quoted message-ID id-left", bytes('Message-ID: <"a>b"@example.com>\r\nIn-Reply-To: <"p>q"@[c>d]>\r\nReferences: <"a>b"@example.com> <"e\\"f"@example.com> <next@[c>d]>\r\n\r\nhi')],
  ["review: space in a quoted message-ID id-left", bytes('Message-ID: <"a b"@example.com>\r\nIn-Reply-To: <"c d"@example.com>\r\n\r\nhi')],
  ["review: format=flowed delsp=yes", bytes("Content-Type: text/plain; format=flowed; delsp=yes\r\n\r\nhello \r\nworld\r\n >quote\r\n")],

  // Real client shapes.
  ["Apple Mail related/alternative", bytes(message(envelope, multi("multipart/alternative", "Apple-Mail=_A", [
    part("text/plain; charset=us-ascii", "hello", ["Content-Transfer-Encoding: 7bit"]),
    multi("multipart/related", "Apple-Mail=_B", [
      part("text/html; charset=us-ascii", "<html><body>hello<img src=\"cid:pic@apple\"></body></html>", ["Content-Transfer-Encoding: 7bit"]),
      part("image/png; name=\"logo.png\"", pngBase64, ["Content-Transfer-Encoding: base64", "Content-Disposition: inline; filename=\"logo.png\"", "Content-Id: <pic@apple>"]),
    ], "; type=\"text/html\""),
  ])))],
  ["Gmail mixed/alternative with PDF", bytes(message(envelope, multi("multipart/mixed", "000000000000abc", [
    multi("multipart/alternative", "000000000000def", [
      part("text/plain; charset=\"UTF-8\"", "Hi Bob,\r\n\r\nSee attached.", []),
      part("text/html; charset=\"UTF-8\"", "<div dir=\"ltr\">Hi Bob,<div><br></div><div>See attached.</div></div>", []),
    ]),
    part("application/pdf; name=\"report.pdf\"", pdfBase64, ["Content-Disposition: attachment; filename=\"report.pdf\"", "Content-Transfer-Encoding: base64", "X-Attachment-Id: f_abc", "Content-ID: <f_abc>"]),
  ])))],
  ["Outlook windows-1252 quoted-printable", bytes(message([...envelope, "Thread-Topic: corpus", "Thread-Index: AQHZ"], multi("multipart/alternative", "_000_DB9PR_", [
    part("text/plain; charset=\"Windows-1252\"", "Price: =80 50 =96 caf=E9\r\n", ["Content-Transfer-Encoding: quoted-printable"]),
    part("text/html; charset=\"Windows-1252\"", "<html><body><p>Price: =80 50 =96 caf=E9</p></body></html>\r\n", ["Content-Transfer-Encoding: quoted-printable"]),
  ])))],
  ["Outlook inline image in related", bytes(message(envelope, multi("multipart/related", "_004_rel_", [
    multi("multipart/alternative", "_000_alt_", [
      part("text/plain; charset=\"us-ascii\"", "see image", ["Content-Transfer-Encoding: quoted-printable"]),
      part("text/html; charset=\"us-ascii\"", "<p>see <img src=3D\"cid:image001.png@01DA\"></p>", ["Content-Transfer-Encoding: quoted-printable"]),
    ]),
    part("image/png; name=\"image001.png\"", pngBase64, ["Content-Description: image001.png", "Content-Disposition: inline; filename=\"image001.png\"; size=95", "Content-ID: <image001.png@01DA>", "Content-Transfer-Encoding: base64"]),
  ], "; type=\"multipart/alternative\"")))],
  ["multipart/signed PGP", bytes(message(envelope, multi("multipart/signed", "sig", [
    part("text/plain; charset=utf-8", "signed body", []),
    part("application/pgp-signature; name=\"signature.asc\"", "-----BEGIN PGP SIGNATURE-----\r\nabc\r\n-----END PGP SIGNATURE-----", ["Content-Disposition: attachment; filename=\"signature.asc\""]),
  ], "; micalg=pgp-sha256; protocol=\"application/pgp-signature\"")))],
  ["multipart/signed S/MIME", bytes(message(envelope, multi("multipart/signed", "smime", [
    part("text/plain; charset=utf-8", "smime body", []),
    part("application/pkcs7-signature; name=\"smime.p7s\"", "MIIBAAAA", ["Content-Transfer-Encoding: base64", "Content-Disposition: attachment; filename=\"smime.p7s\""]),
  ], "; protocol=\"application/pkcs7-signature\"; micalg=sha-256")))],
  ["message/rfc822 attachment", bytes(message(envelope, multi("multipart/mixed", "fwd", [
    part("text/plain", "outer", []),
    part("message/rfc822", forwarded, ["Content-Disposition: attachment; filename=\"forwarded.eml\""]),
  ])))],
  ["message/rfc822 without filename", bytes(message(envelope, multi("multipart/mixed", "fwd", [
    part("text/plain", "outer", []),
    part("message/rfc822", forwarded, []),
  ])))],
  ["text/calendar invite", bytes(message(envelope, multi("multipart/mixed", "cal", [
    multi("multipart/alternative", "calalt", [
      part("text/plain; charset=UTF-8", "You are invited", []),
      part("text/calendar; charset=UTF-8; method=REQUEST", "BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nEND:VCALENDAR", ["Content-Transfer-Encoding: 7bit"]),
    ]),
    part("application/ics; name=\"invite.ics\"", "QkVHSU46VkNBTEVOREFSDQpFTkQ6VkNBTEVOREFS", ["Content-Disposition: attachment; filename=\"invite.ics\"", "Content-Transfer-Encoding: base64"]),
  ])))],
  ["iso-2022-jp body and subject", bytes(message(["From: =?ISO-2022-JP?B?GyRCJDMkcyRLJEEkTxsoQg==?= <jp@example.jp>", "Subject: =?ISO-2022-JP?B?GyRCJDMkcyRLJEEkTxsoQg==?=", "MIME-Version: 1.0"], part("text/plain; charset=ISO-2022-JP", iso2022jp.toString("base64"), ["Content-Transfer-Encoding: base64"])))],
  ["iso-2022-jp 7bit body", bytes(message(["Subject: jp", "MIME-Version: 1.0"], part("text/plain; charset=iso-2022-jp", iso2022jp.toString("latin1"), ["Content-Transfer-Encoding: 7bit"])))],
  ["windows-1252 8bit body and Q subject", bytes(message(["Subject: =?windows-1252?Q?Caf=E9_=80?=", "From: =?windows-1252?Q?Ren=E9?= <rene@example.fr>", "MIME-Version: 1.0"], part("text/plain; charset=windows-1252", "caf\xe9 \x80 \x93quoted\x94", ["Content-Transfer-Encoding: 8bit"])))],
  ["format=flowed paragraph and quote", bytes(message(envelope, part("text/plain; charset=utf-8; format=flowed", "This is a long \r\nparagraph that \r\nflows.\r\n\r\n> quoted \r\n> text\r\n>> deeper\r\n-- \r\nsig", [])))],
  ["format=flowed space stuffing", bytes(message(envelope, part("text/plain; format=flowed", " From the start\r\n >not a quote\r\nplain", [])))],
  ["bare LF message", bytes("From: a@example.com\nTo: b@example.com\nSubject: bare\nContent-Type: multipart/alternative; boundary=b\n\n--b\nContent-Type: text/plain\n\nhello\n--b\nContent-Type: text/html\n\n<p>hello</p>\n--b--\n")],
  ["mixed line endings", bytes("Subject: mixed\r\nContent-Type: text/plain\n\r\nhello\r\nthere\n")],
  ["long folded headers", bytes(message([
    `To: ${Array.from({ length: 12 }, (_value, index) => `"Recipient ${index}" <r${index}@example.com>`).join(",\r\n\t")}`,
    "Subject: =?UTF-8?B?VGhpcyBpcyBhIHZlcnkgbG9uZyBzdWJqZWN0IGxpbmUgdGhhdCBnZXRzIGZvbGRl?=\r\n =?UTF-8?B?ZCBhY3Jvc3MgbXVsdGlwbGUgbGluZXMg4pyJ?=",
    "References: <a@example.com>\r\n <b@example.com>\r\n\t<c@example.com>",
    "In-Reply-To:\r\n <c@example.com>",
    "Message-ID:\r\n <folded@example.com>",
  ], plain("body")))],
  ["RFC 2231 continued UTF-8 filename", bytes(message(envelope, multi("multipart/mixed", "b", [
    part("text/plain", "see file", []),
    part("application/octet-stream", "QUJD", ["Content-Transfer-Encoding: base64", "Content-Disposition: attachment;\r\n filename*0*=UTF-8''r%C3%A9sum%C3%A9%20;\r\n filename*1*=final.pdf"]),
  ])))],
  ["RFC 2047 filename in quoted value", bytes(message(envelope, multi("multipart/mixed", "b", [
    part("text/plain", "see file", []),
    part("application/pdf; name=\"=?UTF-8?B?w6l0w6kucGRm?=\"", "QUJD", ["Content-Transfer-Encoding: base64", "Content-Disposition: attachment; filename=\"=?UTF-8?B?w6l0w6kucGRm?=\""]),
  ])))],
  ["raw UTF-8 headers (RFC 6532)", utf8(message(["From: Zoë <zoe@example.com>", "To: Jürgen <j@example.de>", "Subject: Grüße ✉", "MIME-Version: 1.0"], part("text/plain; charset=utf-8", "Grüße", ["Content-Transfer-Encoding: 8bit"])))],
  ["groups and undisclosed recipients", bytes(message(["From: ada@example.com", "To: Team: a@example.com, \"B, Jr.\" <b@example.com>;, c@example.com", "Cc: undisclosed-recipients:;", "Subject: groups"], plain("hi")))],
  ["comments in addresses", bytes(message(["From: ada@example.com (Ada Lovelace)", "To: (team) bob@example.com, Carol <carol(work)@example.com>", "Subject: comments"], plain("hi")))],
  ["quoted-printable soft breaks and trailing space", bytes(message(envelope, part("text/plain; charset=utf-8", "line one is long and =\r\nwraps  \r\ncaf=C3=A9 =3D done", ["Content-Transfer-Encoding: quoted-printable"])))],
  ["base64 body with whitespace", bytes(message(envelope, part("text/html; charset=utf-8", "PHA+aGVs\r\nbG88L3A+\r\n", ["Content-Transfer-Encoding: base64"])))],
  ["nested multipart/mixed in alternative", bytes(message(envelope, multi("multipart/mixed", "outer", [
    multi("multipart/alternative", "alt", [
      part("text/plain", "plain version", []),
      multi("multipart/related", "rel", [
        part("text/html", "<p>rich <img src=\"cid:x\"></p>", []),
        part("image/gif", "R0lGODlhAQABAAAAACw=", ["Content-Transfer-Encoding: base64", "Content-ID: <x>"]),
      ]),
    ]),
    part("text/csv; name=\"data.csv\"", "a,b\r\n1,2", ["Content-Disposition: attachment; filename=\"data.csv\""]),
  ])))],
  ["unquoted filename with spaces", bytes(message(envelope, multi("multipart/mixed", "b", [
    part("text/plain", "body", []),
    part("application/octet-stream", "raw", ["Content-Disposition: attachment; filename=scan (1).pdf"]),
  ])))],
  ["comments in Content-Type and boundary", bytes(message(envelope, multi("multipart/mixed", "b", [
    part("text/plain (body text); charset=utf-8", "hello", []),
    part("application/pdf", "QUJD", ["Content-Disposition: attachment (saved); filename=\"report (final).pdf\" (note)", "Content-Transfer-Encoding: base64 (encoded)"]),
  ], " (generated)")))],
  ["empty attachment", bytes(message(envelope, multi("multipart/mixed", "b", [
    part("text/plain", "body", []),
    part("text/plain; name=\"empty.txt\"", "", ["Content-Disposition: attachment; filename=\"empty.txt\""]),
  ])))],
  ["attachment disposition without filename", bytes(message(envelope, multi("multipart/mixed", "b", [
    part("text/plain", "body", []),
    part("application/octet-stream", "QUJD", ["Content-Disposition: attachment", "Content-Transfer-Encoding: base64"]),
  ])))],
  ["missing closing boundary", bytes(message(envelope, part("multipart/mixed; boundary=b", "--b\r\nContent-Type: text/plain\r\n\r\nunterminated\r\n")))],
  ["multipart/digest", bytes(message(envelope, multi("multipart/digest", "d", [
    crlf("", forwarded),
    crlf("Content-Type: message/rfc822", "", forwarded),
  ])))],
  ["mailto in angle address", bytes(message(["From: Ada <mailto:ada@example.com>", "Subject: mailto"], plain("hi")))],
];

interface Comparable {
  from?: InboundAddress;
  to: InboundAddress[];
  cc: InboundAddress[];
  subject?: string;
  messageId?: string;
  inReplyTo?: string;
  references: string[];
  text?: string;
  html?: string;
  attachments: { filename?: string; contentType: string; size: number; sha256: string }[];
}

type Field = keyof Comparable;

const fields: readonly Field[] = ["from", "to", "cc", "subject", "messageId", "inReplyTo", "references", "text", "html", "attachments"];

const sha256 = (content: Uint8Array) => createHash("sha256").update(content).digest("hex");

/**
 * postal-mime turns CRLF into LF and ends a single-part body with a line break the message may not
 * have; the SDK keeps the body as sent. Compare text with LF and without one final line break.
 */
const lf = (value: string | undefined) => value?.replaceAll("\r\n", "\n").replace(/\n$/, "") || undefined;

const id = (value: string | undefined) => value?.trim().replace(/^<|>$/g, "") || undefined;

function address(entry: { address?: string; name?: string }): InboundAddress[] {
  if (!entry.address) return [];

  return entry.name ? [{ address: entry.address, name: entry.name }] : [{ address: entry.address }];
}

function postalAddresses(list: readonly Address[] | undefined): InboundAddress[] {
  return (list ?? []).flatMap(entry => "group" in entry && entry.group ? entry.group.flatMap(address) : address(entry));
}

async function fromSdk(raw: Uint8Array): Promise<Comparable> {
  const email: InboundEmail = emailFromMime({ provider: "cloudflare", raw });

  return {
    from: email.from,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    messageId: email.messageId,
    inReplyTo: email.inReplyTo,
    references: email.references,
    text: lf(email.text),
    html: lf(email.html),
    attachments: await Promise.all(email.attachments.map(async attachment => {
      const content = await attachment.read();

      return { filename: attachment.filename, contentType: attachment.contentType, size: content.length, sha256: sha256(content) };
    })),
  };
}

async function fromPostal(raw: Uint8Array): Promise<Comparable> {
  const email: Email = await PostalMime.parse(raw, { attachmentEncoding: "arraybuffer" });

  return {
    from: email.from ? postalAddresses([email.from])[0] : undefined,
    to: postalAddresses(email.to),
    cc: postalAddresses(email.cc),
    subject: email.subject,
    messageId: id(email.messageId),
    inReplyTo: id(email.inReplyTo),
    references: (email.references ?? "").split(/\s+/).flatMap(entry => id(entry) ?? []),
    text: lf(email.text),
    html: lf(email.html),
    attachments: email.attachments.map(attachment => {
      // `arraybuffer` encoding returns bytes: an ArrayBuffer, or a Uint8Array for calendar parts.
      const content = attachment.content instanceof ArrayBuffer ? new Uint8Array(attachment.content) : attachment.content;

      if (!(content instanceof Uint8Array)) throw new Error(`postal-mime returned ${attachment.encoding} content`);

      return { filename: attachment.filename ?? undefined, contentType: attachment.mimeType, size: content.length, sha256: sha256(content) };
    }),
  };
}

/**
 * Fields allowed to differ, keyed by corpus name, each with the reason. Everything not listed
 * must match postal-mime exactly.
 */
const allowed = new Map<string, Partial<Record<Field, string>>>([
  ["review: interleaved parameter comments", {
    text: "A text/plain part with a `name` parameter is a file to the SDK; postal-mime shows it as the body.",
    attachments: "Same part: the SDK keeps it as the named attachment, comments in the unquoted value kept as text.",
  }],
  ["review: Shift_JIS mixed RFC 2231", {
    attachments: "RFC 2231 joins sections in one charset; postal-mime decodes the encoded section alone, and appends a line break to the body.",
  }],
  ["review: ISO-2022-JP mixed RFC 2231", {
    attachments: "RFC 2231 joins sections in one charset; postal-mime loses the ISO-2022-JP shift state, and appends a line break to the body.",
  }],
  ["review: comments around threading IDs", {
    messageId: "Comments are CFWS in msg-id fields (RFC 5322 3.6.4); postal-mime returns the comment text.",
    inReplyTo: "Same: postal-mime keeps the comment in In-Reply-To.",
    references: "Same: postal-mime splits the comment into References entries.",
  }],
  ["review: parentheses in a domain literal", {
    from: "dtext allows ( and ) inside a domain literal (RFC 5322 3.4.1); postal-mime reads them as a comment.",
    to: "Same domain literal in To.",
  }],
  ["message/rfc822 without filename", {
    text: "The SDK keeps a forwarded message as an attachment; postal-mime inlines it into the body text.",
    attachments: "Same part: the SDK returns the message/rfc822 bytes as an attachment.",
  }],
  ["multipart/digest", {
    text: "Digest parts default to message/rfc822, which the SDK keeps as attachments; postal-mime inlines them.",
    attachments: "Same parts, returned by the SDK as message/rfc822 attachments.",
  }],
  ["text/calendar invite", {
    attachments: "postal-mime rewrites line endings of text/calendar and .ics attachments; the SDK returns the exact bytes.",
  }],
  ["unquoted filename with spaces", {
    attachments: "The SDK keeps `(1)` in the unquoted `filename=scan (1).pdf` that mailers send; postal-mime drops it as a comment.",
  }],
  ["mailto in angle address", {
    from: "The SDK strips a `mailto:` prefix from an angle address; postal-mime keeps it in the address.",
  }],
]);

async function mismatches(raw: Uint8Array): Promise<Partial<Record<Field, { sdk: unknown; postal: unknown }>>> {
  const [sdk, postal] = await Promise.all([fromSdk(raw), fromPostal(raw)]);
  const result: Partial<Record<Field, { sdk: unknown; postal: unknown }>> = {};

  for (const field of fields) {
    if (!Bun.deepEquals(sdk[field], postal[field])) result[field] = { sdk: sdk[field], postal: postal[field] };
  }

  return result;
}

describe("MIME parser agrees with postal-mime", () => {
  test.each(corpus)("%s", async (name, raw) => {
    const found = await mismatches(raw);

    if (process.env.MIME_DIFF_DEBUG) console.log(name, JSON.stringify(found));

    expect(Object.keys(found).sort()).toEqual(Object.keys(allowed.get(name) ?? {}).sort());
  });

  test("every allowlist entry names a corpus message", () => {
    const names = new Set(corpus.map(([name]) => name));

    expect([...allowed.keys()].filter(name => !names.has(name))).toEqual([]);
  });
});
