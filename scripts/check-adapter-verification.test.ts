import { expect, test } from "bun:test";
import registry from "../adapter-verification.json";
import { contractTestFilesOnDisk, validateAdapterVerification } from "./check-adapter-verification";

const record = {
  adapter: "resend",
  kind: "auth-check",
  outcome: "pass",
  timestamp: "2026-01-01T00:00:00Z",
  sourceCommit: "a".repeat(40),
  scope: "GET /domains authentication probe",
  source: "maintainer:leo",
  summary: "Authenticated against the provider account without sending.",
};
const withRecords = (...records: unknown[]) => ({ schemaVersion: 1, records });

test("checked-in registry and empty evidence match SDK membership", () => {
  const result = validateAdapterVerification();
  expect(result.schemaVersion).toBe(1);
  expect(result.records).toEqual([]);
});

test("checked-in registry carries only probe metadata, never results or dates", () => {
  for (const check of Object.values(registry.liveChecks)) {
    expect(Object.keys(check).sort()).toEqual(["command", "probe", "secret"]);
  }
  expect(JSON.stringify(registry)).not.toMatch(/\d{4}-\d{2}-\d{2}|lastRun|passed|verifiedAt/i);
});

test("registry rejects fields implying a passing run or date", () => {
  const base = registry.liveChecks.resend;
  for (const check of [
    { ...base, lastPassedAt: "2026-01-01" },
    { ...base, status: "passed" },
    { ...base, probe: "Passed on 2026-01-01." },
  ]) {
    expect(() =>
      validateAdapterVerification(withRecords(), { schemaVersion: 1, liveChecks: { resend: check } }),
    ).toThrow();
  }
  expect(() =>
    validateAdapterVerification(withRecords(), { schemaVersion: 1, liveChecks: { unknown: base } }),
  ).toThrow(/Unknown live adapter/);
});

test("contract test membership in the docs table matches packages/email-sdk/src on disk", () => {
  const onDisk = contractTestFilesOnDisk(["resend", "smtp", "brevo", "nonexistent"]);
  expect(onDisk.resend).toEqual(["adapters.test.ts", "core.test.ts"]);
  expect(onDisk.smtp).toEqual(["smtp.test.ts"]);
  expect(onDisk.brevo).toEqual(["adapters.test.ts"]);
  expect(onDisk.nonexistent).toEqual([]);
});

test("validator fails closed on invalid and unknown evidence", () => {
  expect(() => validateAdapterVerification({ schemaVersion: 2, records: [] })).toThrow();
  expect(() => validateAdapterVerification({ schemaVersion: 1, records: [], rawResponse: "secret" })).toThrow();
  expect(() => validateAdapterVerification(withRecords({ adapter: "unknown" }))).toThrow();
});

test("registry/evidence consistency: probe-backed kinds require a configured probe", () => {
  expect(validateAdapterVerification(withRecords(record)).records).toHaveLength(1);
  for (const kind of ["auth-probe-configured", "auth-check", "send-verified", "delivery-verified"]) {
    expect(() => validateAdapterVerification(withRecords({ ...record, adapter: "postmark", kind }))).toThrow(
      /requires a registered live check/,
    );
  }
  expect(validateAdapterVerification(withRecords({ ...record, adapter: "postmark", kind: "contract-test" })).records).toHaveLength(1);
  expect(() => validateAdapterVerification(withRecords({ ...record, adapter: "not-an-adapter" }))).toThrow(
    /Unknown evidence adapter/,
  );
});
