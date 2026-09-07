import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AdapterVerification } from "../components/adapter-verification";
import {
  EVIDENCE_KINDS,
  evidenceState,
  parseEvidence,
  verificationRows,
  type EvidenceRecord,
} from "./adapter-verification";

const now = new Date("2026-08-01T00:00:00Z");
const record: EvidenceRecord = {
  adapter: "resend",
  kind: "auth-check",
  outcome: "pass",
  timestamp: "2026-07-31T00:00:00Z",
  sourceCommit: "a".repeat(40),
  scope: "GET /domains authentication probe",
  source: "https://github.com/opencoredev/email-sdk/actions/runs/123",
  summary: "Authenticated against the provider account without sending.",
};
const fixture = (value: unknown) => ({ schemaVersion: 1, records: [value] });
const parse = (input: unknown) => parseEvidence(input, undefined, undefined, now);
const empty = { schemaVersion: 1, records: [] };

describe("adapter verification evidence", () => {
  test("empty evidence covers all 24 adapters without inferred passes", () => {
    const rows = verificationRows(empty, now);
    expect(rows).toHaveLength(24);
    expect(rows.filter((row) => row.check)).toHaveLength(6);
    expect(rows.every((row) => row.contractTestFiles.length > 0)).toBe(true);
    expect(rows.every((row) => Object.values(row.evidence).every((value) => value === undefined))).toBe(true);
    expect(evidenceState(undefined, now)).toBe("No published run evidence");
  });

  test("renders the empty state for every adapter and every run column", () => {
    const html = renderToStaticMarkup(createElement(AdapterVerification, { evidence: empty, now }));
    expect(html.match(/No published run evidence/g)).toHaveLength(24 * EVIDENCE_KINDS.length);
    expect(html).toContain("0 published run records");
    expect(html).toContain("6 configured auth probes");
    expect(html.match(/Live check available/g)).toHaveLength(6);
    expect(html.match(/No live check configured/g)).toHaveLength(18);
    expect(html).toContain("Configured probe, not a published passing run.");
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain('role="region"');
    expect(html).not.toContain("Source run");
    expect(html).not.toContain("<time");
    for (const title of ["Contract tests", "Configured auth probe", "Dated auth check", "Verified send", "Verified delivery"]) {
      expect(html).toContain(title);
    }
  });

  test("renders failed, stale, inconclusive and maintainer-attributed fixtures", () => {
    const failed = renderToStaticMarkup(
      createElement(AdapterVerification, { evidence: fixture({ ...record, outcome: "fail", timestamp: "2026-01-01T00:00:00Z" }), now }),
    );
    expect(failed).toContain("Failed · Stale");
    expect(failed).toContain('dateTime="2026-01-01T00:00:00Z"');
    expect(failed).toContain(record.source);
    expect(failed).toContain("Source run · ");
    expect(failed).toContain(record.summary);
    expect(failed).toContain(`Scope: ${record.scope}`);
    const maintainer = renderToStaticMarkup(
      createElement(AdapterVerification, { evidence: fixture({ ...record, outcome: "inconclusive", source: "maintainer:leo" }), now }),
    );
    expect(maintainer).toContain("Inconclusive");
    expect(maintainer).toContain("Source: maintainer:leo");
    expect(maintainer).not.toContain("href=\"maintainer");
  });

  test("dates and outcomes remain distinct from configured probes", () => {
    expect(evidenceState(record, now)).toBe("Passed");
    expect(evidenceState({ ...record, outcome: "fail" }, now)).toBe("Failed");
    expect(evidenceState({ ...record, outcome: "inconclusive" }, now)).toBe("Inconclusive");
    expect(evidenceState({ ...record, timestamp: "2026-01-01T00:00:00Z" }, now)).toBe("Passed · Stale");
    expect(evidenceState({ ...record, outcome: "fail", timestamp: "2026-01-01T00:00:00Z" }, now)).toBe("Failed · Stale");
  });

  test("latest failure supersedes older success without filling other columns", () => {
    const rows = verificationRows(
      { schemaVersion: 1, records: [{ ...record, timestamp: "2026-07-01T00:00:00Z" }, { ...record, outcome: "fail" }] },
      now,
    );
    const resend = rows.find((row) => row.id === "resend");
    expect(resend?.evidence["auth-check"]?.outcome).toBe("fail");
    expect(resend?.evidence["send-verified"]).toBeUndefined();
    expect(resend?.evidence["delivery-verified"]).toBeUndefined();
    expect(resend?.evidence["contract-test"]).toBeUndefined();
  });

  test("rejects unknown adapters and inconsistent registry membership", () => {
    expect(() => parse(fixture({ ...record, adapter: "unknown" }))).toThrow(/Unknown evidence adapter/);
    for (const kind of ["auth-probe-configured", "auth-check", "send-verified", "delivery-verified"]) {
      expect(() => parse(fixture({ ...record, adapter: "smtp", kind }))).toThrow(/requires a registered live check/);
    }
    expect(parse(fixture({ ...record, adapter: "smtp", kind: "contract-test" })).records).toHaveLength(1);
    expect(() => parseEvidence(empty, ["resend"], ["unknown"], now)).toThrow(/Unknown live adapter/);
    expect(() => parseEvidence(empty, ["resend", "resend"], [], now)).toThrow(/Duplicate adapter IDs/);
  });

  test("rejects each missing required field", () => {
    for (const field of Object.keys(record)) {
      const { [field as keyof EvidenceRecord]: _omitted, ...rest } = record;
      expect(() => parse(fixture(rest))).toThrow();
    }
  });

  test("rejects invalid kind, outcome, timestamp, commit, scope, and unknown keys", () => {
    for (const changes of [
      { kind: "verified" },
      { kind: "auth" },
      { outcome: "passed" },
      { outcome: "verified" },
      { timestamp: "yesterday" },
      { timestamp: "2026-01-01" },
      { timestamp: "2099-01-01T00:00:00Z" },
      { sourceCommit: "main" },
      { sourceCommit: "abc123" },
      { scope: "" },
      { payload: { apiKey: "never-publish" } },
      { response: "200 OK" },
    ]) {
      expect(() => parse(fixture({ ...record, ...changes }))).toThrow();
    }
    expect(() => parse({ schemaVersion: 1, records: [record, record] })).toThrow(/Duplicate evidence/);
  });

  test("source must be attributable: maintainer handle or public repository run", () => {
    for (const source of [
      "javascript:alert(1)",
      "https://evil.test/run",
      "https://github.com/opencoredev/email-sdk/actions/runs/1?token=secret",
      "https://user:pass@github.com/opencoredev/email-sdk/actions/runs/1",
      "https://github.com/opencoredev/email-sdk/actions/runs/1#secret",
      "maintainer:",
      "maintainer:-leo",
      "leo",
      "ci",
    ]) {
      expect(() => parse(fixture({ ...record, source }))).toThrow();
    }
    expect(parse(fixture(record)).records).toHaveLength(1);
    expect(parse(fixture({ ...record, source: "maintainer:leo" })).records).toHaveLength(1);
    expect(parse(fixture({ ...record, source: "https://github.com/opencoredev/email-sdk/actions/runs/12/job/34" })).records).toHaveLength(1);
  });

  test("summary must be sanitized: no raw provider responses, credentials, or addresses", () => {
    for (const summary of [
      '{"id":"abc","status":"ok"}',
      "Response: [200]",
      "Authorization: Bearer abcdefghijklmnop",
      "api_key re_1234567890abcdef accepted",
      "token=abc123def456",
      `Got ${"x".repeat(40)} back`,
      "See https://api.resend.com/domains",
      "Sent to ada@example.com",
      "ok",
      "x".repeat(241),
    ]) {
      expect(() => parse(fixture({ ...record, summary }))).toThrow();
    }
  });
});
