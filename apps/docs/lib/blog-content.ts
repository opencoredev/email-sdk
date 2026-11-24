// Reads blog post metadata from the frontmatter of content/blog/**/*.md, the
// one place a post's title, dates, and tags are written. Build scripts and
// tests use this; the site itself reads posts through Blume.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { z } from "zod";

export const blogContentDir = join(import.meta.dirname, "../content/blog");

// YAML reads an unquoted 2026-11-17 as a Date and a quoted one as a string.
const dateString = z.union([
  z.string().transform((value) => value.slice(0, 10)),
  z.date().transform((value) => value.toISOString().slice(0, 10)),
]);

const blogFrontmatterSchema = z.object({
  title: z.string(),
  description: z.string(),
  type: z.literal("blog"),
  date: dateString,
  lastModified: dateString.optional(),
  search: z.object({ tags: z.array(z.string()).optional() }).optional(),
});

export type BlogPostMeta = {
  slug: string;
  file: string;
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  tags: readonly string[];
};

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) return markdownFiles(path);

    return /\.mdx?$/.test(entry) ? [path] : [];
  });
}

/** Parse one post's frontmatter. Throws when a required field is missing. */
export function readBlogPost(file: string): BlogPostMeta {
  const text = readFileSync(file, "utf8");
  const match = /^---\n([\s\S]*?)\n---/.exec(text);

  if (!match) throw new Error(`[blog] ${file} has no frontmatter`);

  const data = blogFrontmatterSchema.parse(Bun.YAML.parse(match[1]));

  const slug = relative(blogContentDir, file)
    .split("/")
    .filter((segment) => !/^\(.*\)$/.test(segment))
    .join("/")
    .replace(/\.mdx?$/, "");

  return {
    slug,
    file,
    title: data.title,
    description: data.description,
    publishedAt: data.date,
    updatedAt: data.lastModified ?? data.date,
    tags: data.search?.tags ?? [],
  };
}

/** Every post under content/blog, newest first. */
export function readBlogPosts(): BlogPostMeta[] {
  return markdownFiles(blogContentDir)
    .map(readBlogPost)
    .toSorted((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}
