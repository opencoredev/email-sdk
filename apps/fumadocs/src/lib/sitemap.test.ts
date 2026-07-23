import { describe, expect, test } from "bun:test";

import { buildSitemapEntries, renderSitemap } from "@/lib/sitemap";

describe("sitemap", () => {
  test("contains only current, indexable pages", () => {
    const entries = buildSitemapEntries({
      siteUrl: "https://email-sdk.dev",
      launchLastModified: "2026-07-22",
      blogLastModified: "2026-07-21",
      blogPosts: [{ url: "/blog/launch", lastmod: "2026-07-21" }],
      docsPages: [{ url: "/docs", lastmod: "2026-07-22" }],
    });

    expect(entries).toHaveLength(9);
    expect(entries.every((entry) => entry.loc.startsWith("https://email-sdk.dev"))).toBe(true);
    expect(entries.some((entry) => entry.loc.includes("/docs/v/"))).toBe(false);
    expect(entries.some((entry) => /\.(json|txt|xml)$/.test(entry.loc))).toBe(false);
  });

  test("renders valid sitemap XML without archived docs or feeds", () => {
    const sitemap = renderSitemap(
      buildSitemapEntries({
        siteUrl: "https://email-sdk.dev",
        launchLastModified: "2026-07-22",
        blogLastModified: "2026-07-21",
        blogPosts: [],
        docsPages: [{ url: "/docs", lastmod: "2026-07-22" }],
      }),
    );

    expect(sitemap).toStartWith('<?xml version="1.0" encoding="UTF-8"?>');
    expect(sitemap).toContain("<urlset");
    expect(sitemap).not.toContain("/docs/v/");
    expect(sitemap).not.toContain("/llms.txt");
    expect(sitemap).not.toContain("/rss.xml");
    expect(sitemap).not.toContain("/feed.json");
  });
});
