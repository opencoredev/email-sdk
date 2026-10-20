import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { parseJsonStrict, jsonString } from "./internal/decode.js";
import { SDK_VERSION } from "./version.js";

test("SDK_VERSION matches package.json (run `bun run version-packages`)", () => {
  const packageJson = parseJsonStrict(
    readFileSync(new URL("../package.json", import.meta.url), "utf8"),
  );

  expect(SDK_VERSION).toBe(jsonString(packageJson, "version") ?? "missing");
});
