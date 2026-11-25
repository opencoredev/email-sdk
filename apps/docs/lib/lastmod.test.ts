import { describe, expect, test } from "bun:test";

import { changesContent, fumadocsPath, pageDataFiles } from "./lastmod";

describe("changesContent", () => {
  test("ignores a patch that only moves the lastModified line", () => {
    const patch = [
      "diff --git a/page.mdx b/page.mdx",
      "--- a/page.mdx",
      "+++ b/page.mdx",
      "@@ -4 +4 @@ title: Page",
      "-lastModified: 2026-09-01",
      "+lastModified: 2026-11-01",
    ].join("\n");

    expect(changesContent(patch)).toBe(false);
  });

  test("counts any other added or removed line", () => {
    const patch = ["--- a/page.mdx", "+++ b/page.mdx", "@@ -9 +9 @@", "-Old text.", "+New text."].join("\n");

    expect(changesContent(patch)).toBe(true);
  });

  test("counts a removed line that starts like a file header", () => {
    expect(changesContent(["@@ -3 +2,0 @@", "---"].join("\n"))).toBe(true);
  });
});

describe("fumadocsPath", () => {
  test("maps current docs pages and lib files to their Fumadocs paths", () => {
    expect(fumadocsPath("apps/docs/content/docs/adapters/resend.mdx")).toBe(
      "apps/fumadocs/content/docs/adapters/resend.mdx",
    );
    expect(fumadocsPath("apps/docs/lib/adapter-support.ts")).toBe(
      "apps/fumadocs/src/lib/adapter-support.ts",
    );
  });

  test("leaves files the migration did not move alone", () => {
    expect(fumadocsPath("adapter-verification.json")).toBeUndefined();
    expect(fumadocsPath("apps/docs/content/(project)/about.mdx")).toBeUndefined();
  });
});

describe("pageDataFiles", () => {
  test("lists the data files of each component a page renders, once each", () => {
    const source = "<AdapterFieldSupport />\n\n<AdapterCapabilitySupport />";

    expect(pageDataFiles(source)).toEqual(["apps/docs/lib/adapter-support.ts"]);
  });

  test("returns nothing for a page without data components", () => {
    expect(pageDataFiles("## Plain page\n\n<ProviderBadge provider=\"resend\" />")).toEqual([]);
  });
});
