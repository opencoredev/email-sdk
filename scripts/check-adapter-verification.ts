import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import registry from "../adapter-verification.json";
import evidence from "../adapter-verification-evidence.json";
import { ADAPTER_SUPPORT_ENTRIES } from "../apps/fumadocs/src/lib/adapter-support";
import { CONTRACT_TEST_FILES, parseEvidence } from "../apps/fumadocs/src/lib/adapter-verification";
import { providers } from "../apps/fumadocs/src/lib/providers";
import { SUPPORTED_MESSAGE_FIELDS } from "../packages/email-sdk/src/utils";

const sdkSrc = new URL("../packages/email-sdk/src/", import.meta.url).pathname;

// Derive which test files import each adapter module; the docs table must match disk.
export function contractTestFilesOnDisk(ids: readonly string[], dir = sdkSrc) {
  const tests = readdirSync(dir).filter((file) => file.endsWith(".test.ts")).sort();
  const sources = tests.map((file) => [file, readFileSync(join(dir, file), "utf8")] as const);
  return Object.fromEntries(
    ids.map((id) => [
      id,
      sources.filter(([, source]) => source.includes(`from "./${id}.js"`)).map(([file]) => file),
    ]),
  ) as Record<string, string[]>;
}

export function validateAdapterVerification(input: unknown = evidence, registryInput: unknown = registry) {
  const sdkIds = Object.keys(SUPPORTED_MESSAGE_FIELDS).sort();
  const docsIds = ADAPTER_SUPPORT_ENTRIES.map(({ id }) => id).sort();
  const catalogIds = providers.map(({ key }) => key).sort();
  if (JSON.stringify(sdkIds) !== JSON.stringify(docsIds) || JSON.stringify(sdkIds) !== JSON.stringify(catalogIds)) {
    throw new Error("Verification adapter membership must match the SDK.");
  }
  const live = registryInput as { schemaVersion?: unknown; liveChecks?: Record<string, Record<string, unknown>> };
  if (live.schemaVersion !== 1 || !live.liveChecks) throw new Error("Unsupported live registry schema.");
  for (const [id, check] of Object.entries(live.liveChecks)) {
    if (!sdkIds.includes(id)) throw new Error(`Unknown live adapter: ${id}`);
    const keys = Object.keys(check).sort();
    if (JSON.stringify(keys) !== JSON.stringify(["command", "probe", "secret"])) {
      throw new Error(`Live check metadata may only describe the configured probe: ${id}`);
    }
    const { command, probe, secret } = check as Record<string, unknown>;
    if (typeof probe !== "string" || !probe.trim() || typeof command !== "string" || !command.startsWith("bun ") || typeof secret !== "string" || !/^[A-Z_]+$/.test(secret)) {
      throw new Error(`Invalid live check metadata: ${id}`);
    }
    if (/\b(?:passed|verified|last run|\d{4}-\d{2}-\d{2})\b/i.test(probe)) {
      throw new Error(`Live check metadata must not imply a result or date: ${id}`);
    }
  }
  const onDisk = contractTestFilesOnDisk(sdkIds);
  for (const id of sdkIds) {
    if (JSON.stringify(onDisk[id]) !== JSON.stringify(CONTRACT_TEST_FILES[id] ?? [])) {
      throw new Error(`CONTRACT_TEST_FILES drifted from disk for ${id}: ${JSON.stringify(onDisk[id])}`);
    }
  }
  return parseEvidence(input, sdkIds, Object.keys(live.liveChecks));
}

if (import.meta.main) {
  try {
    const result = validateAdapterVerification();
    console.log(`Adapter verification evidence valid: ${result.records.length} published records. Validation does not execute live checks.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : "Invalid verification evidence.");
    process.exitCode = 1;
  }
}
