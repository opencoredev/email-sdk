import { describe, expect, test } from "bun:test";

import { getAllBlogPosts, getBlogPostMetaTitle, getPublishedBlogPosts } from "./blog";

describe("blog schedule", () => {
  test("keeps twenty weekly posts scheduled after the June launch posts", () => {
    const scheduled = getAllBlogPosts().filter((post) => post.publishedAt >= "2026-06-17");

    expect(scheduled).toHaveLength(20);

    for (let index = 1; index < scheduled.length; index++) {
      const previous = new Date(`${scheduled[index - 1]?.publishedAt}T00:00:00Z`);
      const current = new Date(`${scheduled[index]?.publishedAt}T00:00:00Z`);
      const days = (current.getTime() - previous.getTime()) / 86_400_000;

      expect(days).toBe(7);
    }
  });

  test("hides future posts from public feeds until their publish date", () => {
    const posts = getPublishedBlogPosts(new Date("2026-06-09T12:00:00Z"));

    expect(posts.map((post) => post.slug)).toEqual([
      "email-provider-fallbacks",
      "introducing-email-sdk",
    ]);
  });

  test("uses a distinct image URL for every blog post", () => {
    const images = getAllBlogPosts().map((post) => post.image);

    expect(new Set(images).size).toBe(images.length);
    expect(images.every((image) => image.startsWith("/og/blog/"))).toBe(true);
  });

  test("keeps post title tags short enough for search results", () => {
    const titles = getAllBlogPosts().map((post) => getBlogPostMetaTitle(post.title));

    expect(titles.every((title) => title.length <= 68)).toBe(true);
    expect(titles.every((title) => title.endsWith(" - Email SDK"))).toBe(true);
  });
});
