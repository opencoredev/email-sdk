import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, test } from "bun:test";

import { getLocalBlogPostDetail, getLocalBlogPostMarkdown } from "./local-blog-runtime";
import { localBlogPosts } from "./local-blog-posts";

const slug = "email-sdk-v1-safer-typescript-transactional-email";

describe("local blog posts", () => {
  test("publishes the v1 launch article with complete metadata", () => {
    const post = localBlogPosts.find((item) => item.slug === slug);

    expect(post).toBeDefined();
    expect(post?.title).toContain("Email SDK v1");
    expect(post?.description.length).toBeGreaterThanOrEqual(40);
    expect(post?.description.length).toBeLessThanOrEqual(170);
    expect(post?.publishedAt).toBe("2026-07-22");
    expect(post?.tags).toContain("TypeScript");
  });

  test("ships every article and social image", () => {
    const images = [
      "../../public/og/blog/email-sdk-v1-safer-typescript-transactional-email.svg",
      "../../public/blog/email-sdk-v1/routing-editorial.webp",
      "../../public/blog/email-sdk-v1/adapter-pipeline.svg",
      "../../public/blog/email-sdk-v1/delivery-certainty.svg",
      "../../public/blog/email-sdk-v1/sending-modes.svg",
    ];

    for (const image of images) {
      expect(existsSync(fileURLToPath(new URL(image, import.meta.url)))).toBeTrue();
    }
  });

  test("renders the article through the sanitized Markdown pipeline", () => {
    const detail = getLocalBlogPostDetail(slug);

    expect(detail).not.toBeNull();
    expect(detail?.html).toContain("The provider API is not the whole boundary");
    expect(detail?.html).toContain("<code>unknown</code> means dispatch may have started");
    expect(detail?.html).toContain("/blog/email-sdk-v1/adapter-pipeline.svg");
    expect(detail?.html).not.toContain("<h1>");
    expect(detail?.html.toLowerCase()).not.toContain("mcp");
  });

  test("every local post has a Markdown body and a social card", () => {
    for (const post of localBlogPosts) {
      expect(getLocalBlogPostMarkdown(post.slug)?.length ?? 0).toBeGreaterThan(500);
      expect(getLocalBlogPostDetail(post.slug)?.html.length ?? 0).toBeGreaterThan(500);
      expect(existsSync(fileURLToPath(new URL(`../../public${post.image}`, import.meta.url)))).toBeTrue();
    }
  });

  test("renders the Mailgun API guide without MDX leftovers", () => {
    const html = getLocalBlogPostDetail("mailgun-api-nodejs-typescript")?.html ?? "";

    expect(html).toContain("api.eu.mailgun.net");
    expect(html).toContain("<table>");
    expect(html).not.toContain("<h1>");
    expect(html).not.toMatch(/<(Callout|Cards|Card|PackageInstallTabs)\b/);
  });
});
