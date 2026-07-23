import { describe, expect, test } from "bun:test";

import {
  findProviderHints,
  normalizeDomainInput,
  parseDmarc,
  parseMx,
  parseSpf,
} from "./dns-checker";

describe("normalizeDomainInput", () => {
  test("accepts a plain domain", () => {
    expect(normalizeDomainInput("example.com")).toBe("example.com");
  });

  test("strips protocol, path, port, email local part, and trailing dot", () => {
    expect(normalizeDomainInput("https://Example.com/path")).toBe("example.com");
    expect(normalizeDomainInput("user@example.com")).toBe("example.com");
    expect(normalizeDomainInput("example.com:443")).toBe("example.com");
    expect(normalizeDomainInput("example.com.")).toBe("example.com");
  });

  test("rejects garbage", () => {
    expect(normalizeDomainInput("not a domain")).toBeNull();
    expect(normalizeDomainInput("localhost")).toBeNull();
    expect(normalizeDomainInput("")).toBeNull();
    expect(normalizeDomainInput("-bad.example.com")).toBeNull();
  });
});

describe("parseSpf", () => {
  test("fails when no SPF record exists", () => {
    const result = parseSpf(["some-verification=abc"]);
    expect(result.record).toBeNull();
    expect(result.findings[0].status).toBe("fail");
  });

  test("passes a healthy record with -all", () => {
    const result = parseSpf(["v=spf1 include:amazonses.com -all"]);
    expect(result.record).toBe("v=spf1 include:amazonses.com -all");
    expect(result.findings.every((finding) => finding.status === "pass")).toBe(true);
  });

  test("fails on multiple SPF records", () => {
    const result = parseSpf(["v=spf1 include:a.com ~all", "v=spf1 include:b.com ~all"]);
    expect(result.findings.some((finding) => finding.status === "fail")).toBe(true);
  });

  test("fails on +all", () => {
    const result = parseSpf(["v=spf1 +all"]);
    expect(result.findings.some((finding) => finding.status === "fail")).toBe(true);
  });

  test("warns on missing all mechanism", () => {
    const result = parseSpf(["v=spf1 include:amazonses.com"]);
    expect(result.findings.some((finding) => finding.status === "warn")).toBe(true);
  });

  test("fails when over 10 DNS lookups", () => {
    const includes = Array.from({ length: 11 }, (_, i) => `include:x${i}.com`).join(" ");
    const result = parseSpf([`v=spf1 ${includes} -all`]);
    expect(
      result.findings.some(
        (finding) => finding.status === "fail" && /lookups/.test(finding.message),
      ),
    ).toBe(true);
  });
});

describe("parseDmarc", () => {
  test("fails when missing", () => {
    const result = parseDmarc([]);
    expect(result.record).toBeNull();
    expect(result.findings[0].status).toBe("fail");
  });

  test("passes p=reject with rua", () => {
    const result = parseDmarc(["v=DMARC1; p=reject; rua=mailto:d@example.com"]);
    expect(result.findings.every((finding) => finding.status === "pass")).toBe(true);
  });

  test("warns on p=none and missing rua", () => {
    const result = parseDmarc(["v=DMARC1; p=none"]);
    expect(result.findings.filter((finding) => finding.status === "warn").length).toBe(2);
  });

  test("warns on partial pct", () => {
    const result = parseDmarc(["v=DMARC1; p=reject; rua=mailto:d@e.com; pct=50"]);
    expect(result.findings.some((finding) => /50%/.test(finding.message))).toBe(true);
  });
});

describe("parseMx", () => {
  test("sorts by priority and passes", () => {
    const result = parseMx(["20 backup.example.com.", "10 primary.example.com."]);
    expect(result.hosts).toEqual(["10 primary.example.com", "20 backup.example.com"]);
    expect(result.findings[0].status).toBe("pass");
  });

  test("warns when empty", () => {
    const result = parseMx([]);
    expect(result.findings[0].status).toBe("warn");
  });
});

describe("findProviderHints", () => {
  test("maps SPF includes to adapter docs", () => {
    const hints = findProviderHints("v=spf1 include:amazonses.com include:_spf.resend.com -all");
    expect(hints.map((hint) => hint.name).sort()).toEqual(["AWS SES", "Resend"]);
    expect(hints.find((hint) => hint.name === "AWS SES")?.docsPath).toBe("/docs/adapters/ses");
  });

  test("returns nothing without a record", () => {
    expect(findProviderHints(null)).toEqual([]);
  });
});
