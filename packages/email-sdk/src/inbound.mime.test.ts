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

describe("addr-spec comments and whitespace", () => {
  test("drops CFWS inside an address the same way in angle and bare forms", () => {
    expect(parseAddressList("Ada <alice(note)@example.com>")).toEqual([{ address: "alice@example.com", name: "Ada" }]);
    expect(parseAddressList("<alice (note) @ example.com>")).toEqual([{ address: "alice@example.com" }]);
    expect(parseAddressList("alice(note)@example.com")).toEqual([{ address: "alice@example.com", name: "note" }]);
    expect(parseAddressList("alice @example.com")).toEqual([{ address: "alice@example.com" }]);
    expect(parseAddressList("alice . smith @ example . com")).toEqual([{ address: "alice.smith@example.com" }]);
  });

  test("keeps quoted local parts verbatim while dropping CFWS around them", () => {
    expect(parseAddressList("<\"a  b\" (x) @example.com>")).toEqual([{ address: "\"a  b\"@example.com" }]);
    expect(parseAddressList("\"a (b)\" @ example.com")).toEqual([{ address: "\"a (b)\"@example.com" }]);
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

describe("hostile and unusual MIME", () => {
  test("trims trailing whitespace in linear time on sender-controlled lines", () => {
    const line = `${" ".repeat(100_000)}x`;
    const started = performance.now();
    const multipart = parseMimeMessage(`Content-Type: multipart/mixed; boundary=b\r\n\r\n--b  \r\n\r\n${line}\r\n--b--\r\n`);
    const quoted = parseMimeMessage(`Content-Transfer-Encoding: quoted-printable\r\n\r\n${line}  \t\r\nnext =\r\nline  `);

    expect(performance.now() - started).toBeLessThan(1000);
    expect(multipart.text).toBe(line);
    expect(quoted.text).toBe(`${line}\r\nnext line  `);
  });

  test("decodes truncated base64 leniently instead of throwing", async () => {
    const parsed = parseMimeMessage("Content-Type: application/octet-stream\r\nContent-Transfer-Encoding: base64\r\n\r\nQUJD\r\nA\r\n");

    expect(await parsed.attachments[0]!.read()).toEqual(new TextEncoder().encode("ABC"));
    expect(() => emailFromMime({ provider: "sparkpost", raw: "Content-Transfer-Encoding: base64\r\n\r\nA" })).not.toThrow();
  });

  test("keeps the trailing line break of a final part that has no closing boundary", async () => {
    const parsed = parseMimeMessage("Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: application/octet-stream\r\n\r\nABC\r\n");
    const closed = parseMimeMessage("Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: application/octet-stream\r\n\r\nABC\r\n--b--\r\n");

    expect(await parsed.attachments[0]!.read()).toEqual(new TextEncoder().encode("ABC\r\n"));
    expect(await closed.attachments[0]!.read()).toEqual(new TextEncoder().encode("ABC"));
  });

  test("keeps multipart/related resources as attachments and picks the root from start", () => {
    const related = (start: string) => parseMimeMessage([
      `Content-Type: multipart/related; boundary=r; type="text/html"${start}`,
      "",
      "--r",
      "Content-Type: text/html",
      "Content-ID: <frame@x>",
      "",
      "<p>frame</p>",
      "--r",
      "Content-Type: text/html",
      "Content-ID: <root@x>",
      "",
      "<p>root <iframe src=\"cid:frame@x\"></iframe></p>",
      "--r--",
    ].join("\r\n"));

    const byStart = related("; start=\"<root@x>\"");

    expect(byStart.html).toBe("<p>root <iframe src=\"cid:frame@x\"></iframe></p>");
    expect(byStart.attachments.map(item => [item.contentType, item.contentId, item.disposition])).toEqual([["text/html", "frame@x", "inline"]]);

    const firstPart = related("");

    expect(firstPart.html).toBe("<p>frame</p>");
    expect(firstPart.attachments.map(item => item.contentId)).toEqual(["root@x"]);
  });
});

describe("header comments and raw UTF-8", () => {
  test("ignores RFC 822 comments in Content-Type and Content-Disposition", async () => {
    const parsed = parseMimeMessage([
      "Content-Type: multipart/mixed (outer); boundary=b (generated by mailer)",
      "",
      "--b",
      "Content-Type: text/plain (body; with a semicolon); charset=utf-8",
      "",
      "hello",
      "--b",
      "Content-Type: application/pdf",
      "Content-Disposition: attachment (saved); filename=\"report (final).pdf\" (quoted name keeps parens)",
      "Content-Transfer-Encoding: base64 (encoded)",
      "",
      "QUJD",
      "--b",
      "Content-Type: application/octet-stream",
      "Content-Disposition: attachment; filename=scan (1).pdf",
      "",
      "raw",
      "--b--",
    ].join("\r\n"));

    expect(parsed.text).toBe("hello");
    expect(parsed.attachments.map(item => [item.filename, item.contentType, item.disposition])).toEqual([
      ["report (final).pdf", "application/pdf", "attachment"],
      ["scan (1).pdf", "application/octet-stream", "attachment"],
    ]);
    expect(await parsed.attachments[0]!.read()).toEqual(new TextEncoder().encode("ABC"));
  });

  test("scans long runs of header comments in linear time", () => {
    const started = performance.now();
    const literal = parseMimeMessage(`Content-Type: application/octet-stream; name=x${"(a)".repeat(50_000)}y\r\n\r\nraw`);
    const unbalanced = parseMimeMessage(`Content-Type: text/plain; charset=utf-8 ${"(".repeat(50_000)}\r\n\r\nhi`);

    expect(performance.now() - started).toBeLessThan(1000);
    expect(literal.attachments[0]!.filename).toBe(`x${"(a)".repeat(50_000)}y`);
    expect(unbalanced.text).toBe("hi");
  });

  test("keeps raw UTF-8 header bytes that look like Latin-1 whitespace", () => {
    const head = new TextEncoder().encode("Subject: Voilà\r\nX-Lead: \u00a0x\r\n\r\nbody");
    const { headers } = parseMimeMessage(head);

    expect(headers.get("subject")).toBe("Voilà");
    expect(headers.get("x-lead")).toBe("\u00a0x");
  });
});

describe("parseAddressList domain literals", () => {
  test("keeps IPv6 domain literals whose colons look like group labels", () => {
    expect(parseAddressList("user@[IPv6:2001:db8::1], Team: a@x.test;")).toEqual([{ address: "user@[IPv6:2001:db8::1]" }, { address: "a@x.test" }]);
    expect(parseAddressList("Ops <ops@[IPv6:2001:db8::2]>, [External] Bob <bob@x.test>")).toEqual([
      { address: "ops@[IPv6:2001:db8::2]", name: "Ops" },
      { address: "bob@x.test", name: "[External] Bob" },
    ]);
  });
});

describe("parseAddressList comments and quotes", () => {
  const ada = { address: "alice@example.com", name: "Ada" };

  // Each input hides an address delimiter inside a comment or quoted string.
  const cases: [input: string, expected: { address: string; name?: string }[]][] = [
    ["Ada <alice(note > text)@example.com>", [ada]],
    ["Ada <alice(note < text)@example.com>", [ada]],
    ["Ada <alice(a, b)@example.com>", [ada]],
    ["Ada <alice(say \"hi)@example.com>", [ada]],
    ["Ada <alice(x@evil.test)@example.com>", [ada]],
    ["Ada <alice(a (nested > deep) b)@example.com>", [ada]],
    ["Ada <alice(escaped \\) > still)@example.com>", [ada]],
    ["Ada <alice(escaped \\( > still)@example.com>", [ada]],
    ["Ada (x > y) <alice@example.com>", [ada]],
    ["Boss <\"a(b>\"@example.com>", [{ address: "\"a(b>\"@example.com", name: "Boss" }]],
    ["Boss <\"a>(b\"@example.com>", [{ address: "\"a>(b\"@example.com", name: "Boss" }]],
    ["alice(note > text)@example.com", [{ address: "alice@example.com", name: "note > text" }]],
    ["(a, \"b) alice@example.com", [{ address: "alice@example.com", name: "a, \"b" }]],
    ["Ops <ops@[a>b]>", [{ address: "ops@[a>b]", name: "Ops" }]],
  ];

  test.each(cases)("%s", (input, expected) => {
    const next = { address: "z@example.com" };

    expect(parseAddressList(input)).toEqual(expected);
    // The hidden delimiter must not leak into list splitting or group handling either.
    expect(parseAddressList(`${input}, z@example.com`)).toEqual([...expected, next]);
    expect(parseAddressList(`Team: ${input}, z@example.com;`)).toEqual([...expected, next]);
  });
});

describe("MIME edge cases (RFC 2045/2046/2047/2231/5322)", () => {
  const attachment = (disposition: string) => [
    "Content-Type: multipart/mixed; boundary=b",
    "",
    "--b",
    "Content-Type: application/octet-stream",
    `Content-Disposition: attachment; ${disposition}`,
    "",
    "raw",
    "--b--",
  ].join("\r\n");

  const filenameOf = (disposition: string) => parseMimeMessage(new TextEncoder().encode(attachment(disposition))).attachments[0]?.filename;

  const filenames: [label: string, disposition: string, expected: string][] = [
    ["unencoded Unicode continuation", "filename*0=\"Ā\"; filename*1=\".txt\"", "Ā.txt"],
    ["unencoded Unicode after an encoded piece", "filename*0*=UTF-8''%C3%A9; filename*1=\"Ā.txt\"", "éĀ.txt"],
    ["encoded piece after an unencoded one", "filename*0=\"Ā\"; filename*1*=%C3%A9.txt", "Āé.txt"],
    ["UTF-8 sequence split across encoded pieces", "filename*0*=UTF-8''%C3; filename*1*=%A9.txt", "é.txt"],
    ["out-of-order pieces", "filename*1=\".txt\"; filename*0=\"a\"", "a.txt"],
    ["Latin-1 charset with a language", "filename*=iso-8859-1'fr'%E9t%E9.txt", "été.txt"],
    ["extended value wins over the plain one", "filename=\"plain.txt\"; filename*=UTF-8''%C3%A9.txt", "é.txt"],
    ["extended value is not decoded again as an encoded word", "filename*=UTF-8''%3D%3FUTF-8%3FB%3FYQ%3D%3D%3F%3D", "=?UTF-8?B?YQ==?="],
    ["encoded word in a quoted filename", "filename=\"=?UTF-8?B?w6kudHh0?=\"", "é.txt"],
    ["encoded word in a quoted continuation", "filename*0=\"=?UTF-8?B?w6k=?=\"; filename*1=\".txt\"", "é.txt"],
    ["encoded word split across quoted continuations", "filename*0=\"=?UTF-8?B?w6ku\"; filename*1=\"dHh0?=\"", "é.txt"],
    ["encoded word beside a percent-encoded piece", "filename*0=\"=?UTF-8?B?w6k=?=\"; filename*1*=%2Etxt", "=?UTF-8?B?w6k=?=.txt"],
    ["encoded word beside a charset piece", "filename*0*=UTF-8''a; filename*1=\"=?UTF-8?B?w6k=?=\"", "a=?UTF-8?B?w6k=?="],
    ["encoded word beside a starred piece with no encoding", "filename*0=\"=?UTF-8?B?w6k=?=\"; filename*1*=.txt", "é.txt"],
  ];

  test.each(filenames)("filename: %s", (_label, disposition, expected) => {
    expect(filenameOf(disposition)).toBe(expected);
  });

  const words: [label: string, input: string, expected: string][] = [
    ["UTF-8 character split across B words", "=?UTF-8?B?ww==?= =?UTF-8?B?qQ==?=", "é"],
    ["UTF-8 character split across Q words", "=?UTF-8?Q?=C3?= =?UTF-8?Q?=A9?=", "é"],
    ["adjacent words in different charsets", "=?ISO-8859-1?Q?=E9?= =?UTF-8?Q?=C3=A9?=", "éé"],
    ["words separated by a folded tab", "=?UTF-8?Q?a?=\t=?UTF-8?Q?b?=", "ab"],
    ["text between words is kept", "=?UTF-8?Q?a?= and =?UTF-8?Q?b?=", "a and b"],
    ["non-ASCII inside a Q word is not an encoded word", "=?UTF-8?Q?Ā?=", "=?UTF-8?Q?Ā?="],
    ["language suffix on the charset", "=?UTF-8*en?Q?=C3=A9?=", "é"],
  ];

  test.each(words)("encoded word: %s", (_label, input, expected) => {
    expect(decodeEncodedWords(input)).toBe(expected);
  });

  const bodies: [label: string, message: string, expected: string | undefined][] = [
    ["boundary line with transport padding", "Content-Type: multipart/mixed; boundary=b\r\n\r\npreamble\r\n--b \t\r\n\r\nhi\r\n--b-- \r\nepilogue", "hi"],
    ["nested boundary that extends the outer one", "Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\nContent-Type: multipart/mixed; boundary=b-1\r\n\r\n--b-1\r\n\r\ninner\r\n--b-1--\r\n--b--", "inner"],
    ["outer boundary that extends the inner one", "Content-Type: multipart/mixed; boundary=b-1\r\n\r\n--b-1\r\nContent-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\n\r\ninner\r\n--b--\r\n--b-1--", "inner"],
    ["Content-Transfer-Encoding in mixed case with whitespace", "Content-Transfer-Encoding:  BASE64 \r\n\r\naGk=", "hi"],
    ["Content-Transfer-Encoding folded onto a tab line", "Content-Transfer-Encoding:\r\n\tQuoted-Printable\r\n\r\nh=69", "hi"],
    ["header folded with a tab", "Content-Type: text/plain;\r\n\tcharset=iso-8859-1\r\n\r\né", "é"],
    ["empty body", "Content-Type: text/plain\r\n\r\n", undefined],
    ["headers without a body separator", "Content-Type: text/plain", undefined],
    ["empty part between boundaries", "Content-Type: multipart/mixed; boundary=b\r\n\r\n--b\r\n--b\r\n\r\nhi\r\n--b--", "hi"],
  ];

  test.each(bodies)("body: %s", (_label, message, expected) => {
    // One char per byte, as a raw message arrives.
    const bytes = Uint8Array.from(message, char => char.charCodeAt(0));

    expect(parseMimeMessage(bytes).text).toBe(expected);
  });
});
