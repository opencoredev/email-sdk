import { describe, expect, test } from "bun:test";

import { mailboxAddress } from "./internal/address.js";
import { isStringMember } from "./internal/decode.js";
import type { EmailAddress } from "./types.js";
import { emailAddressOf } from "./utils.js";

// The helper released before mailboxAddress: the first `<...>` anywhere in the string.
function releasedEmailAddressOf(address: EmailAddress): string {
  if (!isStringMember(address)) return address.email;

  return (address.match(/<([^>]+)>/)?.[1] ?? address).trim();
}

// `changedFromMain` marks the cases where the bare address differs from the released helper. Each
// change is deliberate and listed in the changeset.
const cases: ReadonlyArray<{
  readonly name: string;
  readonly address: EmailAddress;
  readonly expected: string;
  readonly changedFromMain: boolean;
}> = [
  { name: "bare address", address: "ada@example.test", expected: "ada@example.test", changedFromMain: false },
  { name: "padded bare address", address: "  ada@example.test  ", expected: "ada@example.test", changedFromMain: false },
  { name: "object address", address: { email: "ada@example.test", name: "Ada" }, expected: "ada@example.test", changedFromMain: false },
  { name: "Name <a@b>", address: "Ada <ada@example.test>", expected: "ada@example.test", changedFromMain: false },
  { name: "angle-addr only", address: "<ada@example.test>", expected: "ada@example.test", changedFromMain: false },
  { name: "case is kept", address: "Ada <ADA@Example.test>", expected: "ADA@Example.test", changedFromMain: false },
  { name: "quoted name with <...>", address: '"Ada <team>" <ada@example.test>', expected: "ada@example.test", changedFromMain: true },
  { name: "quoted name with >", address: '"Ada > team" <ada@example.test>', expected: "ada@example.test", changedFromMain: false },
  { name: "quoted name with a comma", address: '"Lovelace, Ada" <ada@example.test>', expected: "ada@example.test", changedFromMain: false },
  { name: "quoted name with escaped quotes", address: '"Ada \\"<x>\\" L" <ada@example.test>', expected: "ada@example.test", changedFromMain: true },
  { name: "quoted name with parentheses", address: '"Ada (x)" <ada@example.test>', expected: "ada@example.test", changedFromMain: false },
  { name: "trailing comment", address: "Ada <ada@example.test> (work)", expected: "ada@example.test", changedFromMain: false },
  { name: "trailing comment with <...>", address: "Ada <ada@example.test> (work <team>)", expected: "ada@example.test", changedFromMain: false },
  { name: "comment in the name with <...>", address: "Ada (<team>) <ada@example.test>", expected: "ada@example.test", changedFromMain: true },
  { name: "comment inside the angle-addr", address: "Ada <ada@example.test (work)>", expected: "ada@example.test", changedFromMain: true },
  { name: "leading comment inside the angle-addr", address: "<(work)ada@example.test>", expected: "ada@example.test", changedFromMain: true },
  { name: "plain address with a comment", address: "ada@example.test (work)", expected: "ada@example.test", changedFromMain: true },
  { name: "plain address after a comment", address: "(work) ada@example.test", expected: "ada@example.test", changedFromMain: true },
  { name: "unclosed angle-addr", address: "Ada <ada@example.test", expected: "Ada <ada@example.test", changedFromMain: false },
  { name: "stray closing bracket", address: "attacker@example.com> evil", expected: "attacker@example.com> evil", changedFromMain: false },
];

describe("mailbox addresses", () => {
  test.each(cases)("$name", ({ address, expected, changedFromMain }) => {
    expect(mailboxAddress(address)).toBe(expected);
    expect(emailAddressOf(address)).toBe(expected);
    expect(releasedEmailAddressOf(address) !== expected).toBe(changedFromMain);
  });
});
