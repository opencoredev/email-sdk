import { describe, expect, test } from "bun:test";

import { listedProviders, providers } from "./providers";

describe("listedProviders", () => {
  test("lists every provider on current docs", () => {
    expect(listedProviders({ archived: false })).toEqual(providers);
  });

  test("hides current-only adapters on archived snapshots", () => {
    const keys = listedProviders({ archived: true }).map((provider) => provider.key);

    expect(keys).toContain("resend");
    expect(keys).not.toContain("unosend");
    expect(keys).not.toContain("iterable");
    expect(keys.length).toBeLessThan(providers.length);
  });
});
