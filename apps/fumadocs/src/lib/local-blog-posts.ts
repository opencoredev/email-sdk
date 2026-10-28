import type { BlogPost } from "./blog-types";

export const localBlogPosts: readonly BlogPost[] = [
  {
    slug: "mailgun-api-nodejs-typescript",
    title: "Mailgun API Guide for Node.js and TypeScript",
    description:
      "Use the Mailgun API from Node.js and TypeScript with fetch: API keys, US and EU base URLs, attachments, tags, errors, rate limits, retries, and webhook signatures.",
    publishedAt: "2026-10-28",
    updatedAt: "2026-10-28",
    readTime: "14 min read",
    image: "/og/blog/mailgun-api-nodejs-typescript.svg",
    imageAlt: "Mailgun API guide card: fetch, regions, retries and webhooks in TypeScript",
    tags: ["Mailgun", "Node.js", "TypeScript"],
  },
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
