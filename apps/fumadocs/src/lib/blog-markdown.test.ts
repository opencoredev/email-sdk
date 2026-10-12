import { describe, expect, test } from "bun:test";

import { renderBlogPostMarkdown } from "./blog-markdown";
import type { BlogPost } from "./blog-types";

function post(overrides: Partial<BlogPost> = {}): BlogPost {
  return {
    slug: "email-sdk-v1-safer-typescript-transactional-email",
    title: "Email SDK v1: A Safer TypeScript API for Transactional Email",
    description: "A post about the v1 release.",
    publishedAt: "2026-07-22",
    updatedAt: "2026-07-23",
    readTime: "10 min read",
    image: "/og/blog/email-sdk-v1-safer-typescript-transactional-email.svg",
    imageAlt: "Email SDK v1 image",
    tags: ["TypeScript"],
    ...overrides,
  };
}

describe("renderBlogPostMarkdown", () => {
  test("leads with the title, description, canonical URL, and dates", () => {
    const output = renderBlogPostMarkdown(post(), "Body text.");

    expect(output).toStartWith(
      "# Email SDK v1: A Safer TypeScript API for Transactional Email\n\n> A post about the v1 release.",
    );
    expect(output).toContain(
      "Canonical page: https://email-sdk.dev/blog/email-sdk-v1-safer-typescript-transactional-email",
    );
    expect(output).toContain("Published: 2026-07-22. Updated: 2026-07-23.");
    expect(output).toContain("Body text.");
  });

  test("rewrites root-relative links to absolute URLs", () => {
    const output = renderBlogPostMarkdown(
      post(),
      "See [the Resend adapter](/docs/adapters/resend).",
    );

    expect(output).toContain("](https://email-sdk.dev/docs/adapters/resend)");
    expect(output).not.toContain("](/docs/adapters/resend)");
  });
});
