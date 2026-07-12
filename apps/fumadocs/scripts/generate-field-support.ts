/**
 * Regenerates src/lib/field-support.generated.json from the SDK's
 * SUPPORTED_MESSAGE_FIELDS matrix. The compare pages hydrate on the client, so
 * they can't import the SDK source directly (it pulls in node:fs); this
 * snapshot keeps the pages on a client-safe copy of the same data. A test in
 * src/lib/compare.test.ts fails if the snapshot drifts from the SDK.
 *
 * Run with: bun run field-support:generate (from apps/fumadocs).
 */
import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { SUPPORTED_MESSAGE_FIELDS } from "../../../packages/email-sdk/src/utils";

const outputPath = join(resolve(import.meta.dir, ".."), "src/lib/field-support.generated.json");
writeFileSync(outputPath, `${JSON.stringify(SUPPORTED_MESSAGE_FIELDS, null, 2)}\n`);
console.log(`Wrote ${Object.keys(SUPPORTED_MESSAGE_FIELDS).length} adapters to ${outputPath}`);
