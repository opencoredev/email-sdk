import type { BlogPost } from "./blog-types";
import { localBlogPosts } from "./local-blog-posts";
import { notraPosts } from "./notra-posts.generated";

export type { BlogPost };

const blogMetaTitleSuffix = " - Email SDK";
const maxBlogMetaTitleLength = 68;

// Launch and editorial posts can live in source control, while recurring posts
// continue to come from the Notra snapshot. Local posts win on slug collisions so
// a Notra draft cannot accidentally replace a versioned launch article.
const localSlugs = new Set(localBlogPosts.map((post) => post.slug));
export const blogPosts: readonly BlogPost[] = [
  ...localBlogPosts,
  ...notraPosts.filter((post) => !localSlugs.has(post.slug)),
].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));

export function getBlogPost(slug: string, options: { includeFuture?: boolean } = {}) {
  const post = blogPosts.find((item) => item.slug === slug);

  if (!post) return undefined;
  if (options.includeFuture || isBlogPostPublished(post)) return post;

  return undefined;
}

export function getAllBlogPosts(): BlogPost[] {
  return [...blogPosts];
}

export function getPublishedBlogPosts(date = new Date()): BlogPost[] {
  return getAllBlogPosts()
    .filter((post) => isBlogPostPublished(post, date))
    .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

export function isBlogPostPublished(post: BlogPost, date = new Date()) {
  return post.publishedAt <= formatDateKey(date);
}

export function getBlogPostUrl(slug: string) {
  return `/blog/${slug}`;
}

export function getBlogPostImageUrl(slug: string) {
  return `/og/blog/${slug}.svg`;
}

export function getBlogPostMetaTitle(title: string) {
  const maxTitleLength = maxBlogMetaTitleLength - blogMetaTitleSuffix.length;

  return `${truncateTitle(title, maxTitleLength)}${blogMetaTitleSuffix}`;
}

function truncateTitle(title: string, maxLength: number) {
  if (title.length <= maxLength) return title;

  const stemLimit = Math.max(1, maxLength - 3);
  const wordBoundaryStem = title
    .slice(0, stemLimit)
    .replace(/\s+\S*$/, "")
    .replace(/[.,;:\s]+$/, "");
  const stem = wordBoundaryStem || title.slice(0, stemLimit).trimEnd();

  return `${stem}...`;
}

export function formatBlogDate(value: string) {
  return new Intl.DateTimeFormat("en", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T00:00:00Z`));
}

function formatDateKey(date: Date) {
  return date.toISOString().slice(0, 10);
}
