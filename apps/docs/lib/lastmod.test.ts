import { describe, expect, test } from "bun:test";

import { fumadocsPath, pageDataFiles, withoutLastmod } from "./lastmod";

describe("withoutLastmod", () => {
  test("drops only the front matter lastModified line", () => {
    const before = "---\ntitle: Page\nlastModified: 2026-09-01\n---\n\nBody.\n";
    const after = "---\ntitle: Page\nlastModified: 2026-11-01\n---\n\nBody.\n";

    expect(withoutLastmod(before)).toBe(withoutLastmod(after));
    expect(withoutLastmod(before)).toBe("---\ntitle: Page\n---\n\nBody.\n");
  });

  test("keeps any other change visible", () => {
    const before = "---\ntitle: Page\nlastModified: 2026-09-01\n---\n\nOld text.\n";
    const after = "---\ntitle: Page\nlastModified: 2026-09-01\n---\n\nNew text.\n";

    expect(withoutLastmod(before)).not.toBe(withoutLastmod(after));
  });

  test("leaves a lastModified line in the body alone", () => {
    const text = "---\ntitle: Page\n---\n\nlastModified: 2026-09-01\n";

    expect(withoutLastmod(text)).toBe(text);
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
    expect(fumadocsPath("apps/docs/content/community/plugins.json")).toBe(
      "apps/fumadocs/content/community/plugins.json",
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

  test("follows each component to every data file it renders", () => {
    expect(pageDataFiles('<ProviderGrid />')).toEqual([
      "apps/docs/lib/providers.ts",
      "apps/docs/lib/sponsors.ts",
      "adapter-verification.json",
    ]);
    expect(pageDataFiles("<AdapterVerification />")).toContain("apps/docs/lib/adapter-support.ts");
    expect(pageDataFiles('<EmailExample template="welcome" />')).toEqual([
      "apps/docs/lib/email-example-data.ts",
    ]);
  });

  test("matches whole component names only", () => {
    expect(pageDataFiles("<EmailExampleGallery />")).toEqual(["apps/docs/lib/email-example-data.ts"]);
    expect(pageDataFiles("<ProviderBadgeList />")).toEqual([]);
  });

  test("returns nothing for a page without data components", () => {
    expect(pageDataFiles("## Plain page\n\n<Card title=\"Resend\" />")).toEqual([]);
  });
});
