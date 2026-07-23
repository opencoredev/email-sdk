import { describe, expect, test } from "bun:test";

import { SUPPORTED_MESSAGE_FIELDS } from "../../../../packages/email-sdk/src/utils";
import { comparePairs, getProvider } from "./compare";
import fieldSupport from "./field-support.generated.json";

describe("field-support snapshot", () => {
  test("matches the SDK's SUPPORTED_MESSAGE_FIELDS (run `bun run field-support:generate` if this fails)", () => {
    expect(fieldSupport).toEqual(SUPPORTED_MESSAGE_FIELDS);
  });
});

describe("compare pairs", () => {
  test("slugs are unique and match their provider keys", () => {
    const slugs = comparePairs.map((pair) => pair.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const pair of comparePairs) {
      expect(pair.slug).toBe(`${pair.a}-vs-${pair.b}`);
    }
  });

  test("every pair references known providers with field-support data", () => {
    for (const pair of comparePairs) {
      expect(getProvider(pair.a)).toBeDefined();
      expect(getProvider(pair.b)).toBeDefined();
      expect(fieldSupport[pair.a]).toBeDefined();
      expect(fieldSupport[pair.b]).toBeDefined();
    }
  });

  test("every intro is pair-specific prose of at least 120 words", () => {
    const thin = comparePairs.filter((pair) => pair.intro.split(/\s+/).length < 120);
    expect(thin.map((pair) => pair.slug)).toEqual([]);
  });

  test("intros are not duplicated across pairs", () => {
    const intros = comparePairs.map((pair) => pair.intro);
    expect(new Set(intros).size).toBe(intros.length);
  });
});
