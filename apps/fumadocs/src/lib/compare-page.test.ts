import { describe, expect, test } from "bun:test";

import { getComparePair } from "./compare";
import { renderCompareMarkdown } from "./compare-page";

describe("comparison Markdown mirrors", () => {
  test("renders a valid pair as Markdown with a canonical link", () => {
    const pair = getComparePair("resend-vs-postmark");
    expect(pair).toBeDefined();
    const markdown = renderCompareMarkdown(pair!);

    expect(markdown.startsWith("# Resend vs Postmark")).toBe(true);
    expect(markdown).toContain("Canonical page: https://email-sdk.dev/compare/resend-vs-postmark");
    expect(markdown).toContain("| Message field | Resend | Postmark |");
    expect(markdown).toContain("## Frequently asked questions");
  });

  test("does not render an unknown pair", () => {
    expect(getComparePair("unknown-vs-provider")).toBeUndefined();
  });
});
