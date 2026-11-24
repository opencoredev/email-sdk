import { describe, expect, test } from "bun:test";

import { dkimFindingsFor } from "./dns-resolver";

describe("dkimFindingsFor", () => {
  test("reports an incomplete check when every lookup failed", () => {
    const [finding] = dkimFindingsFor({ found: [], unresolved: ["google", "selector1"] });

    expect(finding?.status).toBe("warn");
    expect(finding?.message).toContain("incomplete");
    expect(finding?.fix).toBeUndefined();
  });

  test("reports a missing key only when every lookup answered", () => {
    const [finding] = dkimFindingsFor({ found: [], unresolved: [] });

    expect(finding?.message).toContain("No DKIM key found");
    expect(finding?.fix).toBeDefined();
  });

  test("passes when a key is found even if other selectors failed", () => {
    const [finding] = dkimFindingsFor({
      found: [{ selector: "google", record: "v=DKIM1; k=rsa; p=abc" }],
      unresolved: ["selector1"],
    });

    expect(finding?.status).toBe("pass");
  });
});
