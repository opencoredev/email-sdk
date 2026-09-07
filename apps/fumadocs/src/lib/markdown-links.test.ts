import { describe, expect, test } from "bun:test";

import { absolutizeSiteLinks } from "@/lib/markdown-links";
import { siteUrl } from "@/lib/shared";

describe("absolutizeSiteLinks", () => {
  test("rewrites root-relative markdown links and hrefs to absolute URLs", () => {
    const markdown = [
      "See [field support](/docs/adapters/field-support).",
      '<Card title="Resend" href="/docs/adapters/resend" />',
    ].join("\n");

    expect(absolutizeSiteLinks(markdown)).toBe(
      [
        `See [field support](${siteUrl}/docs/adapters/field-support).`,
        `<Card title="Resend" href="${siteUrl}/docs/adapters/resend" />`,
      ].join("\n"),
    );
  });

  test("leaves absolute, anchor, and protocol-relative targets untouched", () => {
    const markdown = [
      "[npm](https://www.npmjs.com/package/@opencoredev/email-sdk)",
      "[fallbacks](#fallbacks)",
      "[host](//cdn.example.com/logo.svg)",
    ].join("\n");

    expect(absolutizeSiteLinks(markdown)).toBe(markdown);
  });
});
