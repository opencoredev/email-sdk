import type { BlogPost } from "./blog-types";

export const localBlogPosts: readonly BlogPost[] = [
  {
    slug: "email-sdk-v1-safer-typescript-transactional-email",
    title: "Email SDK v1: A Safer TypeScript API for Transactional Email",
    description:
      "Switching transactional email providers looks like an import change. Preserving behavior across failures and uncertain delivery is the difficult part.",
    publishedAt: "2026-07-22",
    updatedAt: "2026-07-22",
    readTime: "10 min read",
    image: "/og/blog/email-sdk-v1-safer-typescript-transactional-email.svg",
    imageAlt: "Email SDK v1 transactional email routing and delivery safety",
    tags: ["TypeScript", "Transactional email", "Open source"],
  },
];
