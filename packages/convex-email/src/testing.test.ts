import { describe, expect, test } from "bun:test";

import { memoryAdapter, modules, registerConvexEmail, schema, testEmailConfig } from "./testing.js";

describe("convex-email testing helpers", () => {
  test("creates a named memory adapter config", () => {
    expect(memoryAdapter("mailbox")).toEqual({
      kind: "memory",
      name: "mailbox",
    });
  });

  test("exports a sandbox config for local delivery tests", () => {
    expect(testEmailConfig).toMatchObject({
      testMode: true,
      sandboxTo: ["delivered@example.test"],
      maxAttempts: 2,
      retryBaseMs: 10,
    });
  });

  test("exports component registration helpers", () => {
    expect(typeof registerConvexEmail).toBe("function");
    expect(schema).toBeDefined();
    expect(Object.keys(modules)).toContain("./component/lib.ts");
  });
});
