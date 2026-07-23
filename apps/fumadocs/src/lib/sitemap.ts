export type SitemapEntry = {
  loc: string;
  lastmod: string;
  changefreq: "daily" | "weekly" | "monthly";
  priority: string;
};

type SitemapPage = {
  url: string;
  lastmod: string;
};

type BuildSitemapEntriesOptions = {
  siteUrl: string;
  docsPages: SitemapPage[];
  blogPosts: SitemapPage[];
  blogLastModified: string;
  launchLastModified: string;
};

export function buildSitemapEntries({
  siteUrl,
  docsPages,
  blogPosts,
  blogLastModified,
  launchLastModified,
}: BuildSitemapEntriesOptions) {
  return dedupeEntries([
    {
      loc: `${siteUrl}/`,
      lastmod: launchLastModified,
      changefreq: "weekly",
      priority: "1.0",
    },
    {
      loc: `${siteUrl}/blog`,
      lastmod: blogLastModified,
      changefreq: "weekly",
      priority: "0.8",
    },
    {
      loc: `${siteUrl}/about`,
      lastmod: "2026-06-01",
      changefreq: "monthly",
      priority: "0.5",
    },
    {
      loc: `${siteUrl}/stats`,
      lastmod: "2026-07-09",
      changefreq: "daily",
      priority: "0.5",
    },
    {
      loc: `${siteUrl}/contact`,
      lastmod: "2026-06-01",
      changefreq: "monthly",
      priority: "0.5",
    },
    {
      loc: `${siteUrl}/privacy`,
      lastmod: "2026-06-01",
      changefreq: "monthly",
      priority: "0.3",
    },
    {
      loc: `${siteUrl}/terms`,
      lastmod: "2026-06-01",
      changefreq: "monthly",
      priority: "0.3",
    },
    ...blogPosts.map((post) => ({
      loc: `${siteUrl}${post.url}`,
      lastmod: post.lastmod,
      changefreq: "monthly" as const,
      priority: "0.8",
    })),
    ...docsPages.map((page) => ({
      loc: `${siteUrl}${page.url}`,
      lastmod: page.lastmod,
      changefreq: "weekly" as const,
      priority: "0.8",
    })),
  ]);
}

export function renderSitemap(entries: SitemapEntry[]) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(renderEntry).join("\n")}
</urlset>`;
}

function dedupeEntries(entries: SitemapEntry[]) {
  const seen = new Set<string>();
  return entries.filter((entry) => {
    if (seen.has(entry.loc)) return false;
    seen.add(entry.loc);
    return true;
  });
}

function renderEntry(entry: SitemapEntry) {
  return `  <url><loc>${escapeXml(entry.loc)}</loc><lastmod>${entry.lastmod}</lastmod><changefreq>${entry.changefreq}</changefreq><priority>${entry.priority}</priority></url>`;
}

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
