// Pure helpers that turn a raw Notra post into the blog's `BlogPost` shape plus
// a sanitized HTML body. Imported by `fetch-notra-posts.ts` (build time) and by
// the blog unit tests. Deliberately free of any browser/runtime-only imports so
// it can run under Bun during the build; never import this from route code.
import { marked } from "marked";
import sanitizeHtml from "sanitize-html";

import type { BlogPost } from "../src/lib/blog-types";

// Minimum surface we rely on from a Notra `listPosts` post. Typed structurally
// so we don't depend on deep SDK subpath imports.
export type NotraPostInput = {
  id: string;
  title: string;
  slug: string | null;
  content: string;
  markdown: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type MappedPost = {
  post: BlogPost;
  html: string;
};

const readWordsPerMinute = 200;
const excerptMaxLength = 155;
const slugMaxLength = 80;

// Mirrors `getBlogPostImageUrl` in src/lib/blog.ts. Kept in sync by hand because
// this module must not import blog.ts (which imports the generated data file).
export function blogPostImageUrl(slug: string): string {
  return `/og/blog/${slug}.svg`;
}

export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, slugMaxLength)
    .replace(/-+$/g, "");
}

export function dedupeSlug(slug: string, seen: Set<string>): string {
  const base = slug || "post";
  let candidate = base;
  let suffix = 2;

  while (seen.has(candidate)) {
    candidate = `${base}-${suffix}`;
    suffix += 1;
  }

  seen.add(candidate);
  return candidate;
}

export function toDateKey(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);

  return date.toISOString().slice(0, 10);
}

export function estimateReadTime(markdown: string): string {
  const words = markdown.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / readWordsPerMinute));

  return `${minutes} min read`;
}

// Drop a single leading "# Title" line. CMS bodies often repeat the title as the
// first H1; the post page already renders the title, so we avoid a duplicate.
export function stripLeadingH1(markdown: string): string {
  return markdown.replace(/^\s*#\s+.*(?:\r?\n|$)/, "").replace(/^\s+/, "");
}

function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/[*_~]+/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncateAtWord(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;

  const stem = text
    .slice(0, maxLength - 1)
    .replace(/\s+\S*$/, "")
    .replace(/[.,;:\s]+$/, "");

  return `${stem || text.slice(0, maxLength - 1).trimEnd()}…`;
}

export function excerptFromMarkdown(markdown: string, maxLength = excerptMaxLength): string {
  const lines = stripLeadingH1(markdown).split(/\r?\n/);
  let paragraph = "";
  let inFence = false;

  for (const raw of lines) {
    const line = raw.trim();

    if (line.startsWith("```") || line.startsWith("~~~")) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line) {
      if (paragraph) break;
      continue;
    }
    if (/^#{1,6}\s/.test(line)) continue;
    if (line.startsWith("![")) continue;
    if (/^([-*+]|\d+\.|>)\s+/.test(line)) {
      paragraph += `${paragraph ? " " : ""}${line.replace(/^([-*+]|\d+\.|>)\s+/, "")}`;
      continue;
    }

    paragraph += `${paragraph ? " " : ""}${line}`;
  }

  return truncateAtWord(stripInlineMarkdown(paragraph), maxLength);
}

export function renderMarkdownToSafeHtml(markdown: string): string {
  const rawHtml = marked.parse(stripLeadingH1(markdown), {
    async: false,
    gfm: true,
  });

  return sanitizeHtml(rawHtml, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat([
      "img",
      "h1",
      "h2",
      "figure",
      "figcaption",
      "picture",
      "source",
      "del",
      "ins",
      "sup",
      "sub",
    ]),
    allowedAttributes: {
      ...sanitizeHtml.defaults.allowedAttributes,
      img: ["src", "alt", "title", "width", "height", "loading", "decoding"],
      a: ["href", "title", "target", "rel", "name", "id"],
      code: ["class"],
      span: ["class"],
      "*": ["id"],
    },
    allowedSchemes: ["http", "https", "mailto"],
    allowedSchemesByTag: { img: ["http", "https", "data"] },
    transformTags: {
      a: (tagName, attribs) => {
        const isExternal = /^https?:\/\//i.test(attribs.href ?? "");

        return {
          tagName,
          attribs: isExternal
            ? { ...attribs, target: "_blank", rel: "noopener noreferrer" }
            : attribs,
        };
      },
      img: (tagName, attribs) => ({
        tagName,
        attribs: { ...attribs, loading: "lazy", decoding: "async" },
      }),
    },
  }).trim();
}

// Maps one published Notra post into the blog shape. Returns null for drafts or
// posts with no usable title so the caller can skip them.
export function mapNotraPost(input: NotraPostInput, seenSlugs: Set<string>): MappedPost | null {
  if (input.status !== "published") return null;

  const title = input.title?.trim();
  if (!title) return null;

  const markdown = input.markdown ?? "";
  // Always slugify, even an explicit Notra slug: a value like "release/notes"
  // would otherwise break the single-segment /blog/$slug route, the OG image
  // path, and prerender enumeration.
  const baseSlug = slugify(input.slug ?? "") || slugify(title) || slugify(input.id) || "post";
  const slug = dedupeSlug(baseSlug, seenSlugs);

  const post: BlogPost = {
    slug,
    title,
    description: excerptFromMarkdown(markdown) || `${title} — notes from the Email SDK blog.`,
    publishedAt: toDateKey(input.createdAt),
    updatedAt: toDateKey(input.updatedAt),
    readTime: estimateReadTime(markdown),
    image: blogPostImageUrl(slug),
    imageAlt: `${title} — Email SDK blog`,
    tags: [],
  };

  return { post, html: renderMarkdownToSafeHtml(markdown) };
}
