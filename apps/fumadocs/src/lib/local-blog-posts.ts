import type { BlogPost } from "./blog-types";

export const localBlogPosts: readonly BlogPost[] = [
  {
    slug: "sendgrid-alternatives",
    title: "SendGrid Alternatives for Developers: Prices, API Fit, and a Safe Switch",
    description:
      "Compare SendGrid alternatives by price, log retention, and field support, then switch providers in TypeScript with SendGrid kept as the fallback.",
    publishedAt: "2026-10-29",
    updatedAt: "2026-10-29",
    readTime: "11 min read",
    image: "/og/blog/sendgrid-alternatives.svg",
    imageAlt: "SendGrid alternatives card: sourced prices, field support, and a fallback migration in TypeScript",
    tags: ["SendGrid", "Migration", "TypeScript"],
  },
  {
    slug: "mailgun-alternatives",
    title: "Mailgun Alternatives for Developers: Prices, Log Retention, and a Safe Switch",
    description:
      "Compare Mailgun alternatives by price, log retention, and field support, then switch providers in TypeScript with Mailgun kept as the fallback.",
    publishedAt: "2026-10-29",
    updatedAt: "2026-10-29",
    readTime: "11 min read",
    image: "/og/blog/mailgun-alternatives.svg",
    imageAlt: "Mailgun alternatives card: sourced prices, log retention, and a fallback migration in TypeScript",
    tags: ["Mailgun", "Migration", "TypeScript"],
  },
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
