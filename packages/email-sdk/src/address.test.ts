import { describe, expect, test } from "bun:test";

import type { EmailAddress } from "./types.js";
import { emailAddressOf, validateBuiltInAdapter } from "./utils.js";

const cases: ReadonlyArray<{
  readonly name: string;
  readonly address: EmailAddress;
  readonly expected: string;
}> = [
  { name: "bare address", address: "ada@example.test", expected: "ada@example.test" },
  { name: "padded bare address", address: "  ada@example.test  ", expected: "ada@example.test" },
  { name: "object address", address: { email: "ada@example.test", name: "Ada <team>" }, expected: "ada@example.test" },
  { name: "Name <a@b>", address: "Ada <ada@example.test>", expected: "ada@example.test" },
  { name: "angle-addr only", address: "<ada@example.test>", expected: "ada@example.test" },
  { name: "padded angle-addr", address: "Ada < ada@example.test >", expected: "ada@example.test" },
  { name: "case is kept", address: "Ada <ADA@Example.test>", expected: "ADA@Example.test" },
  { name: "second angle-addr is ignored", address: "Ada <ada@example.test> <bob@example.test>", expected: "ada@example.test" },
  { name: "quoted local part", address: '"ada lovelace"@example.test', expected: '"ada lovelace"@example.test' },
  { name: "quoted name with <...>", address: '"Ada <team>" <ada@example.test>', expected: "ada@example.test" },
  { name: "quoted name with >", address: '"Ada > team" <ada@example.test>', expected: "ada@example.test" },
  { name: "quoted name with a comma", address: '"Lovelace, Ada" <ada@example.test>', expected: "ada@example.test" },
  { name: "quoted name with escaped quotes", address: '"Ada \\"<x>\\" L" <ada@example.test>', expected: "ada@example.test" },
  { name: "quoted name with parentheses", address: '"Ada (x)" <ada@example.test>', expected: "ada@example.test" },
  { name: "trailing comment", address: "Ada <ada@example.test> (work)", expected: "ada@example.test" },
  { name: "trailing comment with <...>", address: "Ada <ada@example.test> (work <team>)", expected: "ada@example.test" },
  { name: "comment in the name with <...>", address: "Ada (<team>) <ada@example.test>", expected: "ada@example.test" },
  { name: "nested comment", address: "Ada (a (<team>) b) <ada@example.test>", expected: "ada@example.test" },
  { name: "comment with an escaped parenthesis", address: "Ada (a \\) <team>) <ada@example.test>", expected: "ada@example.test" },
  { name: "comment inside the angle-addr", address: "Ada <ada@example.test (work)>", expected: "ada@example.test" },
  { name: "leading comment inside the angle-addr", address: "<(work)ada@example.test>", expected: "ada@example.test" },
  { name: "plain address with a comment", address: "ada@example.test (work)", expected: "ada@example.test" },
  { name: "plain address after a comment", address: "(work) ada@example.test", expected: "ada@example.test" },
  { name: "comment between tokens", address: "ada( work )bob@example.test", expected: "ada bob@example.test" },
  { name: "address list after a quoted name", address: '"Ada <bad name>" <ada@example.test>,evil@example.test', expected: '"Ada <bad name>" <ada@example.test>,evil@example.test' },
  { name: "address list after an angle-addr", address: "Ada <ada@example.test>, evil@example.test", expected: "Ada <ada@example.test>, evil@example.test" },
  { name: "semicolon after an angle-addr", address: "Ada <ada@example.test>;evil@example.test", expected: "Ada <ada@example.test>;evil@example.test" },
  { name: "group syntax", address: "Team: Ada <ada@example.test>;", expected: "Team: Ada <ada@example.test>;" },
  { name: "unclosed angle-addr", address: "Ada <ada@example.test", expected: "Ada <ada@example.test" },
  { name: "stray closing bracket", address: "attacker@example.com> evil", expected: "attacker@example.com> evil" },
  { name: "unclosed quote", address: '"Ada <ada@example.test>', expected: '"Ada <ada@example.test>' },
  { name: "unclosed comment", address: "Ada <ada@example.test> (work", expected: "Ada <ada@example.test> (work" },
  { name: "trailing backslash in a quote", address: '"Ada\\', expected: '"Ada\\' },
];

describe("emailAddressOf", () => {
  test.each(cases)("$name", ({ address, expected }) => {
    expect(emailAddressOf(address)).toBe(expected);
  });
});

describe("SMTP envelope validation", () => {
  const message = (to: string) => ({
    from: "sender@example.test",
    to,
    subject: "Hi",
    text: "Hi",
  });

  test.each(["Ada <ada@example.test> (work)", "ada@example.test (work)", '"Ada <team>" <ada@example.test>'])(
    "accepts %s",
    (to) => {
      expect(() => validateBuiltInAdapter("smtp", message(to))).not.toThrow();
    },
  );

  test.each(["Ada <ada@example.test", "attacker@example.com> evil", '"Ada <ada@example.test>', "Ada <>", "ada( work )bob@example.test", '"Ada <bad name>" <ada@example.test>,evil@example.test', "Ada <ada@example.test>, evil@example.test"])(
    "rejects %s",
    (to) => {
      expect(() => validateBuiltInAdapter("smtp", message(to))).toThrow("SMTP envelope address");
    },
  );
});
