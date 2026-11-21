// Writes the two feeds Blume doesn't generate, kept at the URLs the Fumadocs
// site served them from:
//   public/feed.json        JSON Feed 1.1 of the blog (Blume builds the RSS feed
//                           at /blog/rss.xml)
//   public/feeds/docs.jsonl schema.org entities, one per docs page, compare page,
//                           and blog post, for NLWeb (listed in /schemamap.xml)
// Both are build output and gitignored. Run after fetch-notra-posts.ts so
// fetched posts are included.
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

import { z } from "zod";

import { readBlogPosts } from "../lib/blog-content";
import { appDescription, appName, siteUrl } from "../lib/shared";

const appDir = join(import.meta.dirname, "..");

const pageFrontmatterSchema = z.object({
  title: z.string(),
  description: z.string().optional(),
});

function mdxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) return mdxFiles(path);

    return entry.endsWith(".mdx") ? [path] : [];
  });
}

function routeFor(file: string) {
  const route = relative(join(appDir, "content"), file)
    .replace(/\.mdx$/, "")
    .split("/")
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join("/")
    .replace(/(^|\/)index$/, "");

  return `/${route}`;
}

function frontmatterOf(file: string) {
  const match = /^---\n([\s\S]*?)\n---/.exec(readFileSync(file, "utf8"));

  return pageFrontmatterSchema.parse(match ? Bun.YAML.parse(match[1]) : {});
}

function article(type: "TechArticle" | "BlogPosting", url: string, fields: Record<string, string>) {
  return {
    "@context": "https://schema.org",
    "@type": type,
    "@id": `${url}#article`,
    url,
    mainEntityOfPage: url,
    ...fields,
    inLanguage: "en",
    isPartOf: { "@id": `${siteUrl}/#website` },
    author: { "@id": `${siteUrl}/#organization` },
    publisher: { "@id": `${siteUrl}/#organization` },
    encoding: { "@type": "MediaObject", encodingFormat: "text/markdown", contentUrl: `${url}.md` },
  };
}

const posts = readBlogPosts();

const pageLines = [join(appDir, "content/docs"), join(appDir, "content/compare")].flatMap((dir) =>
  mdxFiles(dir).map((file) => {
    const { title, description } = frontmatterOf(file);
    const url = `${siteUrl}${routeFor(file)}`;

    return JSON.stringify(
      article("TechArticle", url, { headline: title, name: title, description: description ?? "" }),
    );
  }),
);

const postLines = posts.map((post) => {
  const url = `${siteUrl}/blog/${post.slug}`;

  return JSON.stringify(
    article("BlogPosting", url, {
      headline: post.title,
      name: post.title,
      description: post.description,
      datePublished: post.publishedAt,
      dateModified: post.updatedAt,
    }),
  );
});

const jsonFeed = {
  version: "https://jsonfeed.org/version/1.1",
  title: `${appName} Blog`,
  home_page_url: siteUrl,
  feed_url: `${siteUrl}/feed.json`,
  description: appDescription,
  language: "en",
  items: posts.map((post) => {
    const url = `${siteUrl}/blog/${post.slug}`;

    return {
      id: url,
      url,
      title: post.title,
      summary: post.description,
      date_published: `${post.publishedAt}T00:00:00.000Z`,
      date_modified: `${post.updatedAt}T00:00:00.000Z`,
      tags: post.tags,
    };
  }),
};

mkdirSync(join(appDir, "public/feeds"), { recursive: true });

writeFileSync(join(appDir, "public/feed.json"), `${JSON.stringify(jsonFeed, null, 2)}\n`);

writeFileSync(
  join(appDir, "public/feeds/docs.jsonl"),
  `${[...pageLines, ...postLines].join("\n")}\n`,
);

console.log(
  `[feeds] wrote feed.json (${posts.length} posts) and feeds/docs.jsonl (${pageLines.length + postLines.length} entities)`,
);
