import type { BlogPost } from "./blog-types";

export const localBlogPosts: readonly BlogPost[] = [
  {
    slug: "resend-pricing",
    title: "Resend Pricing: Free Tier, Pro, Scale and Overage",
    description:
      "Resend pricing, checked October 2026: the free tier's 3,000 emails and 100-a-day cap, Pro and Scale plans, overage rates, and the cheapest plan by volume.",
    publishedAt: "2026-10-30",
    updatedAt: "2026-10-30",
    readTime: "8 min read",
    image: "/og/blog/resend-pricing.svg",
    imageAlt: "Resend pricing card: free tier, Pro and Scale plans, and overage rates",
    tags: ["Resend", "Pricing", "Transactional email"],
  },
  {
    slug: "send-email-nodejs-typescript",
    title: "How to Send Email from Node.js and TypeScript",
    description:
      "Send email from Node.js and TypeScript with SMTP and Nodemailer, a provider's HTTP API and fetch, or one client for any provider, and test it without sending.",
    publishedAt: "2026-10-30",
    updatedAt: "2026-10-30",
    readTime: "7 min read",
    image: "/og/blog/send-email-nodejs-typescript.svg",
    imageAlt: "Send email from Node.js card: SMTP, HTTP APIs, and one client for any provider",
    tags: ["Node.js", "TypeScript", "Nodemailer"],
  },
  {
    slug: "resend-api-nodejs-typescript",
    title: "Resend API Guide for Node.js and TypeScript",
    description:
      "Use the Resend API from Node.js and TypeScript with fetch: API keys, attachments, scheduling, idempotency keys, batch sends, rate limits, and webhook signatures.",
    publishedAt: "2026-10-29",
    updatedAt: "2026-10-30",
    readTime: "15 min read",
    image: "/og/blog/resend-api-nodejs-typescript.svg",
    imageAlt: "Resend API guide card: fetch, idempotency keys, retries and webhooks in TypeScript",
    tags: ["Resend", "Node.js", "TypeScript"],
  },
  {
    slug: "sendgrid-alternatives",
    title: "SendGrid Alternatives for Developers, and How to Switch",
    description:
      "Compare SendGrid alternatives by price, log retention, and field support, then switch providers in TypeScript with SendGrid kept as the fallback.",
    publishedAt: "2026-10-29",
    updatedAt: "2026-10-30",
    readTime: "11 min read",
    image: "/og/blog/sendgrid-alternatives.svg",
    imageAlt: "SendGrid alternatives card: sourced prices, field support, and a fallback migration in TypeScript",
    tags: ["SendGrid", "Migration", "TypeScript"],
  },
  {
    slug: "mailgun-alternatives",
    title: "Mailgun Alternatives for Developers, and How to Switch",
    description:
      "Compare Mailgun alternatives by price, log retention, and field support, then switch providers in TypeScript with Mailgun kept as the fallback.",
    publishedAt: "2026-10-29",
    updatedAt: "2026-10-30",
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
    updatedAt: "2026-10-30",
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
