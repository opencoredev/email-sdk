import { describe, expect, test } from "bun:test";

import { resolvePolicy, toMessage, validatePolicy } from "../src/policy.js";

describe("MCP recipient policy", () => {
  test("rejects multiple mailboxes hidden in one recipient entry", () => {
    const policy = resolvePolicy({ allowedDomains: ["example.com"], maxRecipients: 1 });

    for (const to of [
      "attacker@evil.test, allowed@example.com",
      "Evil <attacker@evil.test>, Allowed <allowed@example.com>",
      "attacker@evil.test\nBcc: allowed@example.com",
    ]) {
      expect(
        validatePolicy(
          toMessage({ to, subject: "Subject", text: "body" }, "sender@example.com"),
          policy,
        ),
      ).toBe(false);
    }
  });

  test("accepts one plain or display-name mailbox per entry", () => {
    const policy = resolvePolicy({ allowedDomains: ["example.com"] });

    for (const to of ["allowed@example.com", "Allowed <allowed@example.com>"]) {
      expect(
        validatePolicy(
          toMessage({ to, subject: "Subject", text: "body" }, "sender@example.com"),
          policy,
        ),
      ).toBe(true);
    }
  });
});
