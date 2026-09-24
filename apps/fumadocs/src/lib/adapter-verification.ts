import { z } from "zod";
import registry from "../../../../adapter-verification.json";
import published from "../../../../adapter-verification-evidence.json";
import { ADAPTER_SUPPORT_ENTRIES, type AdapterSupportId } from "./adapter-support";
import type { JsonValue } from "./json";

export const EVIDENCE_STALE_DAYS = 30;

export const EVIDENCE_KINDS = [
  "contract-test",
  "auth-probe-configured",
  "auth-check",
  "send-verified",
  "delivery-verified",
] as const;

export const EVIDENCE_OUTCOMES = ["pass", "fail", "inconclusive"] as const;

// Kinds that describe a provider account interaction; they need a registered probe.
export const PROBE_BACKED_KINDS = new Set<EvidenceKind>([
  "auth-probe-configured",
  "auth-check",
  "send-verified",
  "delivery-verified",
]);

// Which packages/email-sdk/src/*.test.ts files import each adapter module.
// scripts/check-adapter-verification.ts fails release:ci if this drifts from disk.
export const CONTRACT_TEST_FILES = {
  brevo: ["adapters.field-support.test.ts", "adapters.json-providers.test.ts", "adapters.scheduling.test.ts"],
  cloudflare: ["adapters.cloudflare.test.ts", "adapters.field-support.test.ts", "adapters.json-providers.test.ts"],
  iterable: ["adapters.field-support.test.ts", "adapters.sequenzy-iterable-zeptomail.test.ts"],
  jetemail: ["adapters.field-support.test.ts", "adapters.jetemail-primitive-lettermint-lettr.test.ts"],
  lettermint: ["adapters.field-support.test.ts", "adapters.jetemail-primitive-lettermint-lettr.test.ts", "adapters.json-providers.test.ts"],
  lettr: ["adapters.field-support.test.ts", "adapters.jetemail-primitive-lettermint-lettr.test.ts", "adapters.json-providers.test.ts", "adapters.scheduling.test.ts"],
  loops: ["adapters.field-support.test.ts", "adapters.json-providers.test.ts"],
  mailchimp: ["adapters.field-support.test.ts", "adapters.json-providers.test.ts", "adapters.scheduling.test.ts"],
  mailersend: ["adapters.field-support.test.ts", "adapters.json-providers.test.ts", "adapters.scheduling.test.ts"],
  mailgun: ["adapters.scheduling.test.ts", "adapters.unosend-ses-mailgun.test.ts"],
  mailpace: ["adapters.field-support.test.ts", "adapters.json-providers.test.ts"],
  mailtrap: ["adapters.field-support.test.ts", "adapters.json-providers.test.ts", "adapters.scheduling.test.ts"],
  plunk: ["adapters.field-support.test.ts", "adapters.json-providers.test.ts"],
  postmark: ["adapters.field-support.test.ts", "adapters.resend-postmark-sendgrid.test.ts", "adapters.scheduling.test.ts"],
  primitive: ["adapters.field-support.test.ts", "adapters.jetemail-primitive-lettermint-lettr.test.ts"],
  resend: ["adapters.field-support.test.ts", "adapters.resend-postmark-sendgrid.test.ts", "adapters.scheduling.test.ts", "core.telemetry-volume.test.ts"],
  scaleway: ["adapters.field-support.test.ts", "adapters.json-providers.test.ts"],
  sendgrid: ["adapters.json-providers.test.ts", "adapters.resend-postmark-sendgrid.test.ts", "adapters.scheduling.test.ts"],
  sendheron: ["adapters.sendheron.test.ts"],
  sequenzy: ["adapters.field-support.test.ts", "adapters.sequenzy-iterable-zeptomail.test.ts"],
  ses: ["adapters.field-support.test.ts", "adapters.scheduling.test.ts", "adapters.unosend-ses-mailgun.test.ts"],
  smtp: ["smtp.test.ts"],
  graph: ["graph.test.ts"],
  sparkpost: ["adapters.field-support.test.ts", "adapters.scheduling.test.ts"],
  unosend: ["adapters.field-support.test.ts", "adapters.json-providers.test.ts", "adapters.unosend-ses-mailgun.test.ts"],
  zeptomail: ["adapters.json-providers.test.ts", "adapters.sequenzy-iterable-zeptomail.test.ts"],
} as const satisfies Record<AdapterSupportId, readonly string[]>;

const contractTestFilesById = new Map<string, readonly string[]>(Object.entries(CONTRACT_TEST_FILES));

const liveChecksById = new Map(Object.entries(registry.liveChecks));

/** Return the contract test files that import an adapter, or none when the ID is unknown. */
export function contractTestFilesFor(id: string): readonly string[] {
  return contractTestFilesById.get(id) ?? [];
}

const CI_RUN_URL =
  /^https:\/\/github\.com\/opencoredev\/email-sdk\/actions\/runs\/[1-9]\d*(?:\/job\/[1-9]\d*)?$/;

const MAINTAINER = /^maintainer:[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/;

// Reject anything that looks like a credential, raw provider payload, or address.
const UNSANITIZED = [
  /[{}[\]]/,
  /\bbearer\b/i,
  /\bbasic\s+[a-z0-9+/=]{8,}/i,
  /\bauthorization\b/i,
  /api[_-]?key/i,
  /\b(?:token|secret|password|passwd)\b/i,
  /\b(?:re|sk|seq_live|pk|xkeysib|SG)_[A-Za-z0-9]{6,}/,
  /[A-Za-z0-9+/_-]{32,}/,
  /https?:\/\//i,
  /[^\s@]+@[^\s@]+\.[^\s@]+/,
  /"[a-z_]+"\s*:/i,
];

export const evidenceSource = z.string().refine(
  (value) => CI_RUN_URL.test(value) || MAINTAINER.test(value),
  "Use maintainer:<github-handle> or a public repository Actions run/job URL without credentials, query, or fragment.",
);

export const evidenceSummary = z
  .string()
  .trim()
  .min(8)
  .max(240)
  .refine((value) => !UNSANITIZED.some((pattern) => pattern.test(value)), {
    message: "Summary must be a sanitized sentence: no raw provider responses, credentials, URLs, or addresses.",
  });

export const evidenceRecordSchema = z.strictObject({
  adapter: z.string().regex(/^[a-z][a-z0-9-]*$/),
  kind: z.enum(EVIDENCE_KINDS),
  outcome: z.enum(EVIDENCE_OUTCOMES),
  timestamp: z.iso.datetime(),
  sourceCommit: z.string().regex(/^[a-f0-9]{40}$/),
  scope: z.string().trim().min(3).max(120),
  source: evidenceSource,
  summary: evidenceSummary,
});

export const evidenceSchema = z.strictObject({
  schemaVersion: z.literal(1),
  records: z.array(evidenceRecordSchema),
});

export type VerificationEvidence = z.infer<typeof evidenceSchema>;

export type EvidenceRecord = VerificationEvidence["records"][number];

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type EvidenceOutcome = (typeof EVIDENCE_OUTCOMES)[number];

export function parseEvidence(
  input: JsonValue,
  adapterIds: readonly string[] = ADAPTER_SUPPORT_ENTRIES.map(({ id }) => id),
  liveIds: readonly string[] = Object.keys(registry.liveChecks),
  now = new Date(),
): VerificationEvidence {
  const evidence = evidenceSchema.parse(input);
  const known = new Set(adapterIds);

  if (known.size !== adapterIds.length) throw new Error("Duplicate adapter IDs.");

  for (const id of liveIds) {
    if (!known.has(id)) throw new Error(`Unknown live adapter: ${id}`);
  }

  const seen = new Set<string>();

  for (const record of evidence.records) {
    if (!known.has(record.adapter)) throw new Error(`Unknown evidence adapter: ${record.adapter}`);

    if (PROBE_BACKED_KINDS.has(record.kind) && !liveIds.includes(record.adapter)) {
      throw new Error(`${record.kind} evidence requires a registered live check: ${record.adapter}`);
    }

    if (record.kind === "contract-test" && !contractTestFilesById.has(record.adapter)) {
      throw new Error(`contract-test evidence requires a checked-in test file: ${record.adapter}`);
    }

    if (Date.parse(record.timestamp) > now.getTime()) throw new Error("Evidence cannot be future-dated.");
    const key = `${record.adapter}:${record.kind}:${record.timestamp}`;

    if (seen.has(key)) throw new Error(`Duplicate evidence: ${key}`);
    seen.add(key);
  }

  return evidence;
}

const OUTCOME_LABEL: Record<EvidenceOutcome, string> = {
  pass: "Passed",
  fail: "Failed",
  inconclusive: "Inconclusive",
};

export function evidenceState(record: EvidenceRecord | undefined, now = new Date()) {
  if (!record) return "No published run evidence";
  const stale = now.getTime() - Date.parse(record.timestamp) > EVIDENCE_STALE_DAYS * 86_400_000;

  return `${OUTCOME_LABEL[record.outcome]}${stale ? " · Stale" : ""}`;
}

export function verificationRows(input: JsonValue = published, now = new Date()) {
  const evidence = parseEvidence(input, undefined, undefined, now);

  return ADAPTER_SUPPORT_ENTRIES.map((adapter) => {
    const check = liveChecksById.get(adapter.id);

    const latest = (kind: EvidenceKind) =>
      evidence.records
        .filter((record) => record.adapter === adapter.id && record.kind === kind)
        .sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp))[0];

    return {
      ...adapter,
      contractTestFiles: CONTRACT_TEST_FILES[adapter.id],
      check,
      evidence: {
        "contract-test": latest("contract-test"),
        "auth-probe-configured": latest("auth-probe-configured"),
        "auth-check": latest("auth-check"),
        "send-verified": latest("send-verified"),
        "delivery-verified": latest("delivery-verified"),
      } satisfies Record<EvidenceKind, EvidenceRecord | undefined>,
    };
  });
}
