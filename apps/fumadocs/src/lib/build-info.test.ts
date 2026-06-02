import { describe, expect, test } from "bun:test";

import { currentBuildInfo, isOutdatedBuild } from "./build-info";

describe("build info", () => {
  test("uses package metadata as a test-safe fallback", () => {
    expect(currentBuildInfo.buildId).toMatch(/\S+/);
    expect(currentBuildInfo.packageVersion).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("detects when the deployed build differs from the current client", () => {
    expect(isOutdatedBuild("old-build", "new-build")).toBe(true);
    expect(isOutdatedBuild("same-build", "same-build")).toBe(false);
    expect(isOutdatedBuild("same-build", undefined)).toBe(false);
  });
});
