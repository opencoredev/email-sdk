import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { decodeEncodedWords, parseAddressList, parseMimeMessage } from "./inbound/mime.js";
import { emailFromMime } from "./inbound/normalize.js";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./__fixtures__/inbound/${name}`, import.meta.url)));

const eml = fixture("multipart.eml");

describe("parseMimeMessage", () => {
  test("decodes a nested multipart message with every transfer encoding", async () => {
    const parsed = parseMimeMessage(eml);

    expect(parsed.text).toBe("Olá, here is a long line that gets soft-wrapped by the quoted-printable encoder, and an equals sign: =.");
    expect(parsed.html).toBe("<p>Olá <img src=\"cid:logo@acme\"></p>");
    expect(parsed.attachments.map(item => [item.filename, item.contentType, item.disposition, item.contentId])).toEqual([
      [undefined, "image/png", "inline", "logo@acme"],
      ["résumé final.pdf", "application/pdf", "attachment", undefined],
      ["forwarded.eml", "message/rfc822", "attachment", undefined],
    ]);
    expect(await parsed.attachments[0]!.read()).toEqual(fixture("logo.png.bin"));
    expect(await parsed.attachments[1]!.read()).toEqual(fixture("attachment.pdf.bin"));
    expect(parsed.attachments[1]!.size).toBe(fixture("attachment.pdf.bin").length);
    expect(new TextDecoder().decode(parsed.attachments[2]!.content)).toBe("From: a@example.org\r\nSubject: inner\r\n\r\ninner body");
  });

  test("keeps repeated headers in order and unfolds continuation lines", () => {
    const { headers } = parseMimeMessage(eml);

    expect(headers.getAll("x-custom")).toEqual(["one", "two"]);
    expect(headers.getAll("Received")).toHaveLength(2);
    expect(headers.get("references")).toBe("<msg-40@acme.test>  <msg-41@acme.test>");
    expect(headers.get("subject")).toBe("Café order ✉ #42");
    expect([...headers].length).toBe(headers.size);
  });

  test("handles LF-only line endings, missing closing boundaries, and unknown charsets", () => {
    const parsed = parseMimeMessage([
      "Subject: plain",
      "Content-Type: multipart/alternative; boundary=x",
      "",
      "--x",
      "Content-Type: text/plain; charset=x-unknown-charset",
      "",
      "café fallback",
      "--x",
      "Content-Type: text/html",
      "",
      "<b>unterminated</b>",
    ].join("\n"));

    expect(parsed.text).toBe("café fallback");
    expect(parsed.html).toBe("<b>unterminated</b>");
  });

  test("treats a body without a Content-Type as text/plain and survives binary bytes", () => {
    const binary = new Uint8Array([...new TextEncoder().encode("Subject: x\r\n\r\n"), 0xc3, 0xa9, 0x0a]);

    expect(parseMimeMessage(binary).text).toBe("é\n");
    expect(parseMimeMessage("Subject: only headers").text).toBeUndefined();
  });

  test("stops at the depth limit instead of overflowing the stack", () => {
    let message = "Content-Type: text/plain\r\n\r\ninnermost";

    for (let depth = 0; depth < 60; depth += 1) {
      message = `Content-Type: multipart/mixed; boundary=b${depth}\r\n\r\n--b${depth}\r\n${message}\r\n--b${depth}--`;
    }

    expect(() => parseMimeMessage(`Subject: deep\r\n${message}`)).not.toThrow();
  });
});

describe("encoded words and addresses", () => {
  test("decodes B and Q words and drops whitespace between adjacent words", () => {
    expect(decodeEncodedWords("=?utf-8?b?w6k=?= =?ISO-8859-1?Q?=E9t=E9?= plain")).toBe("éété plain");
    expect(decodeEncodedWords("=?utf-8?q?a_b?=")).toBe("a b");
    expect(decodeEncodedWords("=?bogus?X?abc?=")).toBe("=?bogus?X?abc?=");
  });

  test("parses quoted names, groups, comments, and bare addresses", () => {
    expect(parseAddressList("\"Doe, Jane\" <jane@x.test>, Team: a@x.test, (Bob) b@x.test;, c@x.test (Carol)")).toEqual([
      { address: "jane@x.test", name: "Doe, Jane" },
      { address: "a@x.test" },
      { address: "b@x.test", name: "Bob" },
      { address: "c@x.test", name: "Carol" },
    ]);
    expect(parseAddressList("=?UTF-8?B?Sm9zw6k=?= <jose@x.test>")).toEqual([{ address: "jose@x.test", name: "José" }]);
    expect(parseAddressList("undisclosed-recipients:;")).toEqual([]);
  });

  test("keeps parentheses and spacing inside quoted strings", () => {
    expect(parseAddressList("\"a(b)\"@example.com")).toEqual([{ address: "\"a(b)\"@example.com" }]);
    expect(parseAddressList("\"a  b\"@example.com (Note)")).toEqual([{ address: "\"a  b\"@example.com", name: "Note" }]);
    expect(parseAddressList("Boss <\"a(b)\"@example.com>")).toEqual([{ address: "\"a(b)\"@example.com", name: "Boss" }]);
    expect(parseAddressList("\"Ada  (Lovelace)\" (work) <ada@example.com>")).toEqual([{ address: "ada@example.com", name: "Ada  (Lovelace)" }]);
    expect(parseAddressList("(outer (inner) text)   a@example.com")).toEqual([{ address: "a@example.com", name: "outer (inner) text" }]);
  });
});

describe("emailFromMime", () => {
  test("normalizes threading, recipients, and Authentication-Results", () => {
    const email = emailFromMime({ provider: "cloudflare", raw: eml, envelope: { from: "bounce@example.net", to: ["support@acme.test"] }, trustedAuthServIds: ["mx.acme.test"] });

    expect(email.messageId).toBe("msg-42@example.net");
    expect(email.inReplyTo).toBe("msg-41@acme.test");
    expect(email.references).toEqual(["msg-40@acme.test", "msg-41@acme.test"]);
    expect(email.from).toEqual({ address: "jose@example.net", name: "José García" });
    expect(email.to).toEqual([{ address: "support@acme.test", name: "Support, Acme" }, { address: "ops@acme.test" }]);
    expect(email.cc).toEqual([{ address: "ana@acme.test" }, { address: "bob@acme.test", name: "Bob" }]);
    expect(email.replyTo).toEqual([{ address: "replies@example.net" }]);
    expect(email.date?.toISOString()).toBe("2025-10-06T09:00:00.000Z");
    expect(email.security).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass" });
    expect(email.raw).toEqual({ kind: "mime", bytes: eml });
  });
});

describe("review regressions", () => {
  test("an encoded display name cannot replace the sender address", () => {
    const email = emailFromMime({ provider: "cloudflare", raw: "From: =?UTF-8?Q?Boss_=3Cceo@example.com=3E?= <sender@evil.test>\r\nSubject: x\r\n\r\nhi" });

    expect(email.from).toEqual({ address: "sender@evil.test", name: "Boss <ceo@example.com>" });
    expect(email.headers.get("from")).toBe("Boss <ceo@example.com> <sender@evil.test>");
  });

  test("Authentication-Results only counts from trusted authserv-ids, parsed structurally", () => {
    const raw = [
      "Authentication-Results: mx.trusted.test; spf=fail smtp.mailfrom=x.test; dkim=none reason=\"dkim=pass\"",
      "Authentication-Results: attacker.test; spf=pass; dkim=pass; dmarc=pass",
      "Subject: x",
      "",
      "hi",
    ].join("\r\n");

    expect(emailFromMime({ provider: "cloudflare", raw }).security).toEqual({});
    expect(emailFromMime({ provider: "cloudflare", raw, trustedAuthServIds: ["mx.trusted.test"] }).security).toEqual({ spf: "fail", dkim: "none" });
    expect(emailFromMime({ provider: "cloudflare", raw, trustedAuthServIds: ["attacker.test"] }).security).toEqual({ spf: "pass", dkim: "pass", dmarc: "pass" });
  });

  test("a quoted display name cannot replace the sender address", () => {
    const email = emailFromMime({ provider: "cloudflare", raw: "From: \"Boss <ceo@example.com>\" <sender@evil.test>\r\n\r\nhi" });

    expect(email.from).toEqual({ address: "sender@evil.test", name: "Boss <ceo@example.com>" });
    expect(parseAddressList("(note <x@y.test>) real@z.test")).toEqual([{ address: "real@z.test", name: "note <x@y.test>" }]);
    expect(parseAddressList("Boss <\"a>b\"@example.com>, c@example.com")).toEqual([{ address: "\"a>b\"@example.com", name: "Boss" }, { address: "c@example.com" }]);
  });

  test("only the topmost trusted Authentication-Results header counts", () => {
    const raw = "Authentication-Results: mx.trusted.test; none\r\nAuthentication-Results: mx.trusted.test; spf=pass; dkim=pass; dmarc=pass\r\n\r\nhi";

    expect(emailFromMime({ provider: "cloudflare", raw, trustedAuthServIds: ["mx.trusted.test"] }).security).toEqual({});
  });

  test("an alternative made of several parts is kept whole", () => {
    const parsed = parseMimeMessage("Content-Type: multipart/alternative; boundary=a\r\n\r\n--a\r\nContent-Type: multipart/mixed; boundary=m\r\n\r\n--m\r\nContent-Type: text/plain\r\n\r\nintroduction\r\n--m\r\nContent-Type: text/plain\r\n\r\nconclusion\r\n--m--\r\n--a--");

    expect(parsed.text).toBe("introduction\nconclusion");
  });

  test("a multipart child without headers keeps its body", () => {
    expect(parseMimeMessage("Content-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\n\r\nHello\r\n--x--").text).toBe("Hello");
    expect(parseMimeMessage("\r\nbody only").text).toBe("body only");
  });

  test("an attached multipart entity stays an attachment", () => {
    const parsed = parseMimeMessage([
      "Content-Type: multipart/mixed; boundary=outer",
      "",
      "--outer",
      "Content-Type: text/plain",
      "",
      "real body",
      "--outer",
      "Content-Type: multipart/mixed; boundary=inner",
      "Content-Disposition: attachment; filename=\"bundle.mime\"",
      "",
      "--inner",
      "Content-Type: text/plain",
      "",
      "attached content",
      "--inner--",
      "--outer--",
    ].join("\r\n"));

    expect(parsed.text).toBe("real body");
    expect(parsed.attachments.map(item => [item.filename, item.contentType])).toEqual([["bundle.mime", "multipart/mixed"]]);
    expect(new TextDecoder().decode(parsed.attachments[0]!.content)).toContain("attached content");
  });

  test("multipart/alternative keeps the last alternative of each type", () => {
    const parsed = parseMimeMessage([
      "Content-Type: multipart/alternative; boundary=a",
      "",
      "--a",
      "Content-Type: text/plain",
      "",
      "fallback",
      "--a",
      "Content-Type: text/plain",
      "",
      "preferred",
      "--a",
      "Content-Type: multipart/related; boundary=r",
      "",
      "--r",
      "Content-Type: text/html",
      "",
      "<p>rich</p>",
      "--r",
      "Content-Type: image/png",
      "Content-ID: <i@x>",
      "",
      "png",
      "--r--",
      "--a--",
    ].join("\r\n"));

    expect(parsed.text).toBe("preferred");
    expect(parsed.html).toBe("<p>rich</p>");
    expect(parsed.attachments).toHaveLength(1);
  });
});
